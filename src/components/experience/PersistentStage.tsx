"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useSessionMedia } from "@/components/media/SessionMedia";
import { useAnalysis } from "@/components/api/AnalysisProvider";
import { PoseCanvas } from "@/components/analysis/PoseCanvas";
import { Icon } from "./Icons";
import { isPortraitCrop } from "@/lib/player-source";
import { paintSoftly, placeSoftly } from "@/lib/soft-blur";

export function PersistentStage({
  pose,
  geometry,
}: {
  pose: boolean;
  geometry: boolean;
}) {
  const {
    media,
    videoRef,
    pendingPlaybackRef,
    presentation,
    playback,
    updateLook,
    updatePlayback,
  } = useSessionMedia();
  const { analysis } = useAnalysis();
  const src = presentation?.src || media.src;
  const stageRef = useRef<HTMLDivElement>(null);
  const atmosphereRef = useRef<HTMLCanvasElement>(null);
  const memoryRef = useRef<HTMLCanvasElement>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [pageFullscreen, setPageFullscreen] = useState(false);
  const fullscreen = nativeFullscreen || pageFullscreen;
  const sampledSource = useRef("");
  const [aspect, setAspect] = useState(16 / 9);
  const [sourceDimensions, setSourceDimensions] = useState({ src: "", width: 0, height: 0 });
  const immersiveCrop = presentation?.kind === "crop" && sourceDimensions.src === src
    && isPortraitCrop(sourceDimensions.width, sourceDimensions.height)
    // Cover-fitting a portrait crop on a landscape screen zooms in and cuts the skater off.
    && !fullscreen;
  useEffect(() => {
    const stage = stageRef.current;
    const syncFullscreen = () =>
      setNativeFullscreen(Boolean(stage) && document.fullscreenElement === stage);
    // Full screen the whole stage so the pose and angle overlays stay on the video.
    // iPhone Safari can only full screen a bare <video>, so fall back to covering the page.
    const enter = () => {
      if (stage?.requestFullscreen)
        void stage.requestFullscreen().catch(() => setPageFullscreen(true));
      else setPageFullscreen(true);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    window.addEventListener("footage-fullscreen", enter);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      window.removeEventListener("footage-fullscreen", enter);
    };
  }, []);
  useEffect(() => {
    if (!pageFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPageFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageFullscreen]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const sample = () => {
      if (!context || video.readyState < 2 || !video.videoWidth) return;
      try {
        context.drawImage(video, 0, 0, 32, 24);
        const { data } = context.getImageData(0, 0, 32, 24);
        let r = 0,
          g = 0,
          b = 0,
          count = 0;
        // Sample the actual scene, leaving out its brightest ice and darkest letterboxing.
        for (let i = 0; i < data.length; i += 4) {
          const light = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (light < 18 || light > 235) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        if (!count) return;
        const tint = {
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count),
        };
        const first = sampledSource.current !== src;
        sampledSource.current = src;
        updateLook({
          tint,
          accent: `rgb(${tint.r}, ${tint.g}, ${tint.b})`,
          ...(first ? { poster: canvas.toDataURL("image/jpeg", 0.65) } : {}),
        });
      } catch {
        /* Media without CORS still plays; its poster supplies the atmosphere. */
      }
    };
    video.addEventListener("loadeddata", sample);
    video.addEventListener("seeked", sample);
    const timer = window.setInterval(() => {
      if (!video.paused) sample();
    }, 1500);
    sample();
    return () => {
      clearInterval(timer);
      video.removeEventListener("loadeddata", sample);
      video.removeEventListener("seeked", sample);
    };
  }, [src, videoRef, updateLook]);

  useEffect(() => {
    const video = videoRef.current;
    const stage = stageRef.current;
    const canvas = atmosphereRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!video || !stage || !canvas || !context || !src) return;
    delete canvas.dataset.unblurred;
    canvas.removeAttribute("style");
    const draw = () => {
      if (video.readyState < 2 || !video.videoWidth) return;
      if (!("unblurred" in canvas.dataset)) {
        const width = stage.clientWidth, height = stage.clientHeight;
        const box = { left: -0.06 * width, top: -0.06 * height, width: 1.12 * width, height: 1.12 * height };
        try {
          const pad = paintSoftly(canvas, context, video, video.videoWidth, video.videoHeight, box, 48, { saturate: 1.1 });
          placeSoftly(canvas, box, pad);
          return;
        } catch {
          // Footage without CORS can't be read back; CSS blurs it instead.
          canvas.dataset.unblurred = "";
          canvas.removeAttribute("style");
        }
      }
      const height = Math.max(1, Math.round(160 * video.videoHeight / video.videoWidth));
      if (canvas.width !== 160 || canvas.height !== height) {
        canvas.width = 160;
        canvas.height = height;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    };
    video.addEventListener("loadeddata", draw);
    video.addEventListener("seeked", draw);
    window.addEventListener("resize", draw);
    const timer = window.setInterval(() => { if (!video.paused) draw(); }, 125);
    draw();
    return () => {
      window.clearInterval(timer);
      video.removeEventListener("loadeddata", draw);
      video.removeEventListener("seeked", draw);
      window.removeEventListener("resize", draw);
    };
  }, [src, videoRef]);

  const poster = media.poster;
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = memoryRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!stage || !canvas || !context || !poster) return;
    delete canvas.dataset.unblurred;
    canvas.removeAttribute("style");
    let image: HTMLImageElement | undefined, cancelled = false;
    const draw = () => {
      if (!image) return;
      if (!("unblurred" in canvas.dataset)) {
        const width = stage.clientWidth, height = stage.clientHeight;
        const box = { left: -0.12 * width, top: -0.12 * height, width: 1.24 * width, height: 1.24 * height };
        try {
          const pad = paintSoftly(canvas, context, image, image.naturalWidth, image.naturalHeight, box, 80, { saturate: 0.68, brightness: 0.7 });
          placeSoftly(canvas, box, pad);
          return;
        } catch {
          canvas.dataset.unblurred = "";
          canvas.removeAttribute("style");
        }
      }
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.drawImage(image, 0, 0);
    };
    const load = (cors: boolean) => {
      const next = new Image();
      if (cors) next.crossOrigin = "anonymous";
      next.onload = () => {
        if (cancelled) return;
        image = next;
        draw();
      };
      // A poster host without CORS still displays; it just can't be read back.
      next.onerror = () => {
        if (cancelled || !cors) return;
        canvas.dataset.unblurred = "";
        load(false);
      };
      next.src = poster;
    };
    load(true);
    window.addEventListener("resize", draw);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", draw);
    };
  }, [poster]);

  const activePose = presentation ? presentation.pose : analysis?.pose;
  const showPose = Boolean(
    playback.ready &&
      analysis?.analysis_id === media.analysisId &&
      (pose || geometry),
  );
  return (
    <div
      ref={stageRef}
      className={`video-stage${pageFullscreen ? " is-fullscreen" : ""}`}
      aria-label="Active footage"
    >
      <div className="scene-wash" />
      {poster && <canvas ref={memoryRef} className="scene-memory" aria-hidden="true" />}
      <canvas ref={atmosphereRef} className="scene-live" aria-hidden="true" />
      <video
        data-testid="footage-player"
        ref={videoRef}
        className={`footage-player${immersiveCrop ? " footage-cropped" : ""}`}
        style={{
          "--video-aspect": aspect,
          ...(immersiveCrop ? { objectFit: "cover", maskImage: "none" } : {}),
        } as CSSProperties}
        src={src || undefined}
        crossOrigin="anonymous"
        playsInline
        controls={fullscreen}
        loop
        preload="auto"
        muted={playback.muted}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setAspect(video.videoWidth / video.videoHeight || 16 / 9);
          setSourceDimensions({ src, width: video.videoWidth, height: video.videoHeight });
          video.playbackRate = playback.rate;
          const pending = pendingPlaybackRef.current;
          if (pending) {
            video.currentTime = Math.min(
              Math.max(0, video.duration - 0.01),
              pending.time,
            );
            pendingPlaybackRef.current = null;
            if (pending.play)
              void video.play().catch(() => updatePlayback({ playing: false }));
          }
          updatePlayback({
            duration: video.duration,
            ready: true,
            error: null,
          });
        }}
        onTimeUpdate={(event) =>
          updatePlayback({ time: event.currentTarget.currentTime })
        }
        onPlay={() => updatePlayback({ playing: true, error: null })}
        onPause={() => updatePlayback({ playing: false })}
        onError={() => {
          if (src)
            updatePlayback({
              ready: false,
              error:
                "This footage could not load. Try selecting it again or add the original video.",
            });
        }}
      />
      {showPose && (
        <PoseCanvas
          videoRef={videoRef}
          pose={activePose}
          source={src}
          fit={immersiveCrop ? "cover" : "contain"}
          geometry={geometry}
          showSkeleton={pose}
        />
      )}
      <div className="scene-feather" />
      <button
        type="button"
        className="fullscreen-back"
        aria-label="Back to previous view"
        onClick={() => {
          if (document.fullscreenElement === stageRef.current)
            void document.exitFullscreen().catch(() => {});
          setPageFullscreen(false);
        }}
      >
        <Icon name="back" />
        <span>Back</span>
      </button>
    </div>
  );
}
