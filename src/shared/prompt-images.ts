export type PromptImage = { name: string; dataUrl: string };
export const MAX_PROMPT_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export function validPromptImages(value: unknown): value is PromptImage[] {
  return Array.isArray(value) && value.length <= MAX_PROMPT_IMAGES && value.every((image) =>
    image && typeof image.name === "string" && image.name.length <= 255
    && typeof image.dataUrl === "string" && image.dataUrl.length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64
    && IMAGE_DATA_URL.test(image.dataUrl));
}

export function buildPromptInput(text: string, images: PromptImage[] = []) {
  return [
    ...(text ? [{ type: "text", text }] : []),
    ...images.map((image) => ({ type: "image", url: image.dataUrl }))
  ];
}
