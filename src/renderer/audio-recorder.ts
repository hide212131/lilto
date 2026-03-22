type AudioRecorderOptions = {
  onLevel?: (level: number) => void;
};

export class AudioRecorder {
  private readonly onLevel?: (level: number) => void;

  private stream: MediaStream | null = null;

  private audioContext: AudioContext | null = null;

  private sourceNode: MediaStreamAudioSourceNode | null = null;

  private processorNode: ScriptProcessorNode | null = null;

  private muteGain: GainNode | null = null;

  private chunks: Float32Array[] = [];

  private sampleRate = 44100;

  constructor(options: AudioRecorderOptions = {}) {
    this.onLevel = options.onLevel;
  }

  async start(): Promise<void> {
    if (this.stream) {
      return;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext();
    this.sampleRate = this.audioContext.sampleRate;
    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.muteGain = this.audioContext.createGain();
    this.muteGain.gain.value = 0;
    this.chunks = [];

    this.processorNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.chunks.push(copy);
      this.onLevel?.(computeLevel(copy));
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.muteGain);
    this.muteGain.connect(this.audioContext.destination);
  }

  async stop(): Promise<Uint8Array> {
    if (!this.stream || !this.audioContext || !this.processorNode || !this.sourceNode || !this.muteGain) {
      return new Uint8Array();
    }

    this.processorNode.disconnect();
    this.sourceNode.disconnect();
    this.muteGain.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
    await this.audioContext.close();

    const wav = encodeWav(this.chunks, this.sampleRate);

    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.muteGain = null;
    this.chunks = [];
    this.onLevel?.(0);

    return wav;
  }

  async discard(): Promise<void> {
    await this.stop();
  }
}

function computeLevel(samples: Float32Array): number {
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    total += samples[index] * samples[index];
  }
  return Math.min(1, Math.sqrt(total / samples.length) * 2.5);
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Uint8Array {
  const targetSampleRate = 16000;
  const merged = mergeChunks(chunks);
  const resampled = sampleRate === targetSampleRate
    ? merged
    : resamplePcm(merged, sampleRate, targetSampleRate);
  const sampleCount = resampled.length;
  const bytesPerSample = 2;
  const dataLength = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let index = 0; index < resampled.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, resampled[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function resamplePcm(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (samples.length === 0) {
    return samples;
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const fraction = sourceIndex - leftIndex;
    output[index] = samples[leftIndex] * (1 - fraction) + samples[rightIndex] * fraction;
  }

  return output;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
