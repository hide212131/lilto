use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use cron::Schedule;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::io::{Error as IoError, ErrorKind as IoErrorKind};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex as AsyncMutex;
use tokio_cron_scheduler::{Job, JobScheduler};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ScheduleKind {
    OneShot,
    Cron,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NotificationPayload {
    session_id: String,
    message: String,
    follow_up_instruction: Option<String>,
    notification_decision_criteria: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ScheduleRecord {
    id: String,
    title: Option<String>,
    kind: ScheduleKind,
    run_at_utc: Option<String>,
    cron_expr: Option<String>,
    timezone: String,
    notification: NotificationPayload,
    enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ScheduleSummary {
    id: String,
    title: Option<String>,
    kind: ScheduleKind,
    run_at: Option<String>,
    cron_expr: Option<String>,
    timezone: String,
    session_id: String,
    notification_message: String,
    follow_up_instruction: Option<String>,
    notification_decision_criteria: Option<String>,
    next_run_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Command {
    Create {
        request_id: String,
        schedule: UpsertSchedule,
    },
    List {
        request_id: String,
    },
    Update {
        request_id: String,
        id: String,
        schedule: UpsertSchedule,
    },
    Delete {
        request_id: String,
        id: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
struct UpsertSchedule {
    id: Option<String>,
    title: Option<String>,
    kind: ScheduleKind,
    run_at: Option<String>,
    cron_expr: Option<String>,
    timezone: Option<String>,
    notification: NotificationPayload,
}

#[derive(Clone)]
struct SchedulerState {
    db_path: PathBuf,
    scheduler: JobScheduler,
    jobs: Arc<AsyncMutex<HashMap<String, Uuid>>>,
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    let db_path = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("scheduler.db"));

    init_db(&db_path)?;

    let scheduler = JobScheduler::new().await?;
    let state = SchedulerState {
        db_path: db_path.clone(),
        scheduler: scheduler.clone(),
        jobs: Arc::new(AsyncMutex::new(HashMap::new())),
    };

    let stdout_lock = Arc::new(Mutex::new(()));
    for record in load_enabled_schedules(&db_path)? {
        register_schedule(&state, record, stdout_lock.clone()).await?;
    }

    scheduler.start().await?;
    print_json(
        &stdout_lock,
        json!({
            "type": "ready",
            "db_path": db_path.display().to_string()
        }),
    );

    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let response = match handle_command(&state, &line, stdout_lock.clone()).await {
            Ok(value) => value,
            Err(error) => json!({
                "type": "error",
                "message": format!("{:#}", error)
            }),
        };
        print_json(&stdout_lock, response);
    }

    Ok(())
}

async fn handle_command(
    state: &SchedulerState,
    line: &str,
    stdout_lock: Arc<Mutex<()>>,
) -> Result<Value> {
    let command: Command = serde_json::from_str(line).context("invalid JSON command")?;
    match command {
        Command::Create {
            request_id,
            schedule,
        } => {
            let record = upsert_to_record(&state.db_path, None, schedule)?;
            insert_schedule(&state.db_path, &record)?;
            register_schedule(state, record.clone(), stdout_lock).await?;
            Ok(json!({
                "type": "response",
                "request_id": request_id,
                "ok": true,
                "result": schedule_to_summary(&record)?
            }))
        }
        Command::List { request_id } => {
            let items = load_enabled_schedules(&state.db_path)?
                .into_iter()
                .map(|record| schedule_to_summary(&record))
                .collect::<Result<Vec<_>>>()?;
            Ok(json!({
                "type": "response",
                "request_id": request_id,
                "ok": true,
                "result": { "items": items }
            }))
        }
        Command::Update {
            request_id,
            id,
            schedule,
        } => {
            ensure_schedule_exists(&state.db_path, &id)?;
            unregister_schedule(state, &id).await?;
            let record = upsert_to_record(&state.db_path, Some(id.clone()), schedule)?;
            replace_schedule(&state.db_path, &id, &record)?;
            register_schedule(state, record.clone(), stdout_lock).await?;
            Ok(json!({
                "type": "response",
                "request_id": request_id,
                "ok": true,
                "result": schedule_to_summary(&record)?
            }))
        }
        Command::Delete { request_id, id } => {
            ensure_schedule_exists(&state.db_path, &id)?;
            unregister_schedule(state, &id).await?;
            disable_schedule(&state.db_path, &id)?;
            Ok(json!({
                "type": "response",
                "request_id": request_id,
                "ok": true,
                "result": { "id": id, "deleted": true }
            }))
        }
    }
}

fn upsert_to_record(
    db_path: &Path,
    existing_id: Option<String>,
    schedule: UpsertSchedule,
) -> Result<ScheduleRecord> {
    let is_create = existing_id.is_none();
    let id = existing_id
        .or(schedule.id)
        .unwrap_or_else(|| format!("cron-{}", Uuid::new_v4().simple()));
    let timezone = schedule
        .timezone
        .unwrap_or_else(|| "Asia/Tokyo".to_string());
    let _: Tz = timezone
        .parse()
        .with_context(|| format!("invalid timezone: {}", timezone))?;

    let (run_at_utc, cron_expr) = match schedule.kind {
        ScheduleKind::OneShot => {
            let run_at = schedule
                .run_at
                .context("run_at is required for one_shot schedule")?;
            let run_at_utc = DateTime::parse_from_rfc3339(&run_at)
                .context("run_at must be RFC3339")?
                .with_timezone(&Utc)
                .to_rfc3339();
            (Some(run_at_utc), None)
        }
        ScheduleKind::Cron => {
            let cron_expr = schedule
                .cron_expr
                .context("cron_expr is required for cron schedule")?;
            let _ = Schedule::from_str(&cron_expr).context("cron_expr is invalid")?;
            (None, Some(cron_expr))
        }
    };

    if is_create && has_enabled_schedule(db_path, &id)? {
        return Err(anyhow!("schedule already exists: {}", id));
    }

    Ok(ScheduleRecord {
        id,
        title: schedule.title.filter(|value| !value.trim().is_empty()),
        kind: schedule.kind,
        run_at_utc,
        cron_expr,
        timezone,
        notification: schedule.notification,
        enabled: true,
    })
}

async fn register_schedule(
    state: &SchedulerState,
    record: ScheduleRecord,
    stdout_lock: Arc<Mutex<()>>,
) -> Result<()> {
    let job = build_job(state, record.clone(), stdout_lock).await?;
    let guid = job.guid();
    state.scheduler.add(job).await?;
    state.jobs.lock().await.insert(record.id.clone(), guid);
    Ok(())
}

async fn build_job(
    state: &SchedulerState,
    record: ScheduleRecord,
    stdout_lock: Arc<Mutex<()>>,
) -> Result<Job> {
    match record.kind {
        ScheduleKind::OneShot => {
            let run_at = record
                .run_at_utc
                .as_deref()
                .context("one_shot schedule missing run_at_utc")?;
            let run_at = DateTime::parse_from_rfc3339(run_at)
                .context("invalid stored run_at_utc")?
                .with_timezone(&Utc);

            if run_at <= Utc::now() {
                disable_schedule(&state.db_path, &record.id)?;
                return Err(anyhow!(
                    "cannot register one_shot schedule in the past: {}",
                    record.id
                ));
            }

            let delay = (run_at - Utc::now())
                .to_std()
                .context("failed to calculate one_shot delay")?;
            let row_id = record.id.clone();
            let notification = record.notification.clone();
            let db_path = state.db_path.clone();
            let jobs = state.jobs.clone();

            Job::new_one_shot_async(delay, move |_uuid, _l| {
                let row_id = row_id.clone();
                let notification = notification.clone();
                let db_path = db_path.clone();
                let jobs = jobs.clone();
                let stdout_lock = stdout_lock.clone();
                Box::pin(async move {
                    print_json(
                        &stdout_lock,
                        json!({
                            "type": "fired",
                            "id": row_id,
                            "notification": notification,
                            "fired_at": Utc::now().to_rfc3339()
                        }),
                    );
                    let disable_id = row_id.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        disable_schedule(&db_path, &disable_id)
                    })
                    .await;
                    jobs.lock().await.remove(&row_id);
                })
            })
            .map_err(Into::into)
        }
        ScheduleKind::Cron => {
            let cron_expr = record
                .cron_expr
                .clone()
                .context("cron schedule missing cron_expr")?;
            let timezone: Tz = record
                .timezone
                .parse()
                .with_context(|| format!("invalid timezone: {}", record.timezone))?;
            let row_id = record.id.clone();
            let notification = record.notification.clone();

            Job::new_async_tz(cron_expr.as_str(), timezone, move |_uuid, _l| {
                let row_id = row_id.clone();
                let notification = notification.clone();
                let stdout_lock = stdout_lock.clone();
                Box::pin(async move {
                    print_json(
                        &stdout_lock,
                        json!({
                            "type": "fired",
                            "id": row_id,
                            "notification": notification,
                            "fired_at": Utc::now().to_rfc3339()
                        }),
                    );
                })
            })
            .map_err(Into::into)
        }
    }
}

async fn unregister_schedule(state: &SchedulerState, id: &str) -> Result<()> {
    if let Some(job_id) = state.jobs.lock().await.remove(id) {
        state.scheduler.remove(&job_id).await?;
    }
    Ok(())
}

fn init_db(db_path: &Path) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          title TEXT,
          kind TEXT NOT NULL,
          run_at_utc TEXT,
          cron_expr TEXT,
          timezone TEXT NOT NULL,
          notification_json TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1
        );
        "#,
    )?;
    Ok(())
}

fn insert_schedule(db_path: &Path, record: &ScheduleRecord) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        r#"
        INSERT INTO schedules (id, title, kind, run_at_utc, cron_expr, timezone, notification_json, enabled)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            kind = excluded.kind,
            run_at_utc = excluded.run_at_utc,
            cron_expr = excluded.cron_expr,
            timezone = excluded.timezone,
            notification_json = excluded.notification_json,
            enabled = 1
        "#,
        params![
            record.id,
            record.title,
            kind_to_str(&record.kind),
            record.run_at_utc,
            record.cron_expr,
            record.timezone,
            serde_json::to_string(&record.notification)?,
        ],
    )?;
    Ok(())
}

fn replace_schedule(db_path: &Path, existing_id: &str, record: &ScheduleRecord) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        r#"
        UPDATE schedules
        SET id = ?1,
            title = ?2,
            kind = ?3,
            run_at_utc = ?4,
            cron_expr = ?5,
            timezone = ?6,
            notification_json = ?7,
            enabled = 1
        WHERE id = ?8
        "#,
        params![
            record.id,
            record.title,
            kind_to_str(&record.kind),
            record.run_at_utc,
            record.cron_expr,
            record.timezone,
            serde_json::to_string(&record.notification)?,
            existing_id,
        ],
    )?;
    Ok(())
}

fn load_enabled_schedules(db_path: &Path) -> Result<Vec<ScheduleRecord>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        r#"
        SELECT id, title, kind, run_at_utc, cron_expr, timezone, notification_json, enabled
        FROM schedules
        WHERE enabled = 1
        ORDER BY id
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        let kind: String = row.get(2)?;
        let notification_json: String = row.get(6)?;
        let notification = serde_json::from_str::<NotificationPayload>(&notification_json)
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    notification_json.len(),
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
        Ok(ScheduleRecord {
            id: row.get(0)?,
            title: row.get(1)?,
            kind: str_to_kind(&kind).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    kind.len(),
                    rusqlite::types::Type::Text,
                    Box::new(IoError::new(IoErrorKind::InvalidData, error)),
                )
            })?,
            run_at_utc: row.get(3)?,
            cron_expr: row.get(4)?,
            timezone: row.get(5)?,
            notification,
            enabled: row.get::<_, i64>(7)? == 1,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn has_enabled_schedule(db_path: &Path, id: &str) -> Result<bool> {
    let conn = Connection::open(db_path)?;
    let exists: i64 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM schedules WHERE id = ?1 AND enabled = 1)",
        params![id],
        |row| row.get(0),
    )?;
    Ok(exists != 0)
}

fn has_schedule(db_path: &Path, id: &str) -> Result<bool> {
    let conn = Connection::open(db_path)?;
    let exists: i64 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM schedules WHERE id = ?1)",
        params![id],
        |row| row.get(0),
    )?;
    Ok(exists != 0)
}

fn ensure_schedule_exists(db_path: &Path, id: &str) -> Result<()> {
    if has_schedule(db_path, id)? {
        return Ok(());
    }
    Err(anyhow!("schedule not found: {}", id))
}

fn disable_schedule(db_path: &Path, id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "UPDATE schedules SET enabled = 0 WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

fn schedule_to_summary(record: &ScheduleRecord) -> Result<ScheduleSummary> {
    Ok(ScheduleSummary {
        id: record.id.clone(),
        title: record.title.clone(),
        kind: record.kind.clone(),
        run_at: record.run_at_utc.clone(),
        cron_expr: record.cron_expr.clone(),
        timezone: record.timezone.clone(),
        session_id: record.notification.session_id.clone(),
        notification_message: record.notification.message.clone(),
        follow_up_instruction: record.notification.follow_up_instruction.clone(),
        notification_decision_criteria: record.notification.notification_decision_criteria.clone(),
        next_run_at: compute_next_run_at(record)?,
    })
}

fn compute_next_run_at(record: &ScheduleRecord) -> Result<Option<String>> {
    match record.kind {
        ScheduleKind::OneShot => Ok(record.run_at_utc.clone()),
        ScheduleKind::Cron => {
            let expr = record
                .cron_expr
                .as_deref()
                .context("cron schedule missing cron_expr")?;
            let schedule = Schedule::from_str(expr).context("invalid cron expression")?;
            let timezone: Tz = record
                .timezone
                .parse()
                .with_context(|| format!("invalid timezone: {}", record.timezone))?;
            let next = schedule
                .upcoming(timezone)
                .next()
                .map(|value| value.with_timezone(&Utc).to_rfc3339());
            Ok(next)
        }
    }
}

fn kind_to_str(kind: &ScheduleKind) -> &'static str {
    match kind {
        ScheduleKind::OneShot => "one_shot",
        ScheduleKind::Cron => "cron",
    }
}

fn str_to_kind(value: &str) -> std::result::Result<ScheduleKind, String> {
    match value {
        "one_shot" => Ok(ScheduleKind::OneShot),
        "cron" => Ok(ScheduleKind::Cron),
        other => Err(format!("unknown schedule kind: {}", other)),
    }
}

fn print_json(stdout_lock: &Arc<Mutex<()>>, value: Value) {
    let _guard = stdout_lock.lock().unwrap();
    println!("{}", value);
}
