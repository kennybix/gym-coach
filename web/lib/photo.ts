/* Photo capture. On the native app a raw <input type=file> is unreliable in the WebView, so use
   the Capacitor Camera plugin (lets the user pick Camera OR gallery). On the web we fall back to
   a file input. Returns a downscaled JPEG data URL, or null if cancelled. */
import { Capacitor } from "@capacitor/core";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export async function captureNativePhoto(): Promise<string | null> {
  const { Camera, CameraSource, CameraResultType } = await import("@capacitor/camera");
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Prompt, // "Take a photo" or "Choose from gallery"
      resultType: CameraResultType.DataUrl,
      quality: 70,
      width: 1280,
      correctOrientation: true,
      promptLabelHeader: "Add a progress photo",
      promptLabelPhoto: "Choose from gallery",
      promptLabelPicture: "Take a photo",
    });
    return photo.dataUrl ?? null;
  } catch {
    return null; // user cancelled / permission denied
  }
}

/* Downscale a File picked via <input type=file> (web). */
export async function downscaleFile(file: File, max = 1280, quality = 0.72): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return c.toDataURL("image/jpeg", quality);
}
