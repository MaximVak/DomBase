"use client";

import { useEffect, useRef, useState } from "react";
import { kioskCopy } from "./copy";
import type { KioskLanguage } from "./copy";

export function ClockCamera({ language, disabled, onCapture }: { language: KioskLanguage; disabled: boolean; onCapture: (photo: Blob) => void }) {
  const text = kioskCopy[language];
  const video = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    if (!open || disabled) return;
    let closed = false;
    let stream: MediaStream | undefined;
    const preview = video.current;
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } }, audio: false });
        if (closed) { stream.getTracks().forEach(track => track.stop()); return; }
        if (preview) { preview.srcObject = stream; await preview.play(); }
      } catch {
        if (!closed) { setOpen(false); setFailed(true); }
      }
    }
    void start();
    return () => {
      closed = true;
      stream?.getTracks().forEach(track => track.stop());
      if (preview) preview.srcObject = null;
    };
  }, [open, disabled]);

  function capture() {
    const preview = video.current;
    if (!preview?.videoWidth || capturing || disabled) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 360 / Math.max(preview.videoWidth, preview.videoHeight));
    canvas.width = Math.max(1, Math.round(preview.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(preview.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) { setFailed(true); return; }
    setCapturing(true);
    context.drawImage(preview, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(photo => {
      if (video.current !== preview) return;
      setCapturing(false);
      setOpen(false);
      setReady(false);
      if (photo?.size && photo.size <= 128 * 1024) onCapture(photo);
      else setFailed(true);
    }, "image/jpeg", 0.75);
  }

  return <div className="kiosk-camera">
    {open && !disabled ? <>
      <video ref={video} muted playsInline autoPlay aria-label={text.cameraPreview} onPlaying={() => setReady(true)} />
      <div className="kiosk-actions">
        <button type="button" disabled={!ready || capturing} onClick={capture}>{text.captureAndClockIn}</button>
        <button type="button" disabled={capturing} onClick={() => { setOpen(false); setReady(false); }}>{text.closeCamera}</button>
      </div>
    </> : <button type="button" disabled={disabled} onClick={() => { setFailed(false); setReady(false); setOpen(true); }}>{text.openCamera}</button>}
    {failed ? <p role="status">{text.cameraUnavailable}</p> : null}
  </div>;
}
