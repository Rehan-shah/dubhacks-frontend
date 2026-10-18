"use client";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useSessionMedia } from "@/components/media/SessionMedia";
import { useAnalysis } from "@/components/api/AnalysisProvider";
import { skateApi } from "@/lib/api";
import { extractVideoFrames, type VideoFrame } from "@/lib/video-frames";
import { Icon } from "./Icons";
import { elementName } from "@/lib/element-names";
export function timecode(time: number) {
  const ms = Math.floor(Math.max(0, time) * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
// Decoded move thumbnails are kept on the device so reopening a clip shows them instantly.
function readThumb(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeThumb(key: string, image: string) {
  try { localStorage.setItem(key, image); } catch { /* Storage full or private browsing. */ }
}
export function Timeline({ detailed }: { detailed: boolean }) {
  const {
    media,
    presentation,
    playback,
    seek,
    togglePlay,
    toggleMuted,
    videoRef,
    updatePlayback,
  } = useSessionMedia();
  const { analysis, selectMove } = useAnalysis();
  const [moveError, setMoveError] = useState("");
  const [unavailable, setUnavailable] = useState("");
  const [decoded, setDecoded] = useState<{ src: string; frames: VideoFrame[] }>(
    { src: "", frames: [] },
  );
  const src = presentation?.src || media.src;
  const fps = analysis?.pose?.fps || 30;
  const moves = analysis && analysis.analysis_id === media.analysisId
    ? analysis.player_view?.timeline ?? analysis.moves
    : undefined;
  const timestamps = useMemo(() => moves?.length
    ? moves.map((move) => Math.max(0, move.segment.start_s))
    : undefined, [moves]);
  const previewSrc = moves?.length ? media.src : src;
  const frameKey = JSON.stringify([previewSrc, timestamps]);
  useEffect(() => {
    if (!previewSrc) return;
    const task = new AbortController();
    if (!moves?.length || !analysis) {
      extractVideoFrames(previewSrc, task.signal, timestamps)
        .then((frames) => {
          if (!task.signal.aborted) setDecoded({ src: frameKey, frames });
        })
        .catch(() => { if (!task.signal.aborted) setUnavailable(frameKey); });
      return () => task.abort();
    }
    // Load move previews in parallel and show each one as soon as it decodes.
    const previews: (VideoFrame | undefined)[] = [];
    const publish = () => {
      if (!task.signal.aborted) setDecoded({ src: frameKey, frames: previews.filter((f): f is VideoFrame => !!f) });
    };
    void Promise.allSettled(moves.map(async (move, index) => {
      const thumbKey = `skatecue.thumb:${analysis.analysis_id}:${move.n}`;
      const cached = readThumb(thumbKey);
      if (cached) {
        previews[index] = { image: cached, time: move.segment.start_s };
        publish();
        return;
      }
      const detail = analysis.default_move?.move.n === move.n
        ? analysis.default_move
        : await skateApi.move(analysis.analysis_id, move.n, "normal", task.signal);
      const moveSrc = detail.videos.crop || detail.videos.segment;
      const localTime = Math.max(0, move.segment.start_s - detail.move.segment.start_s);
      const [frame] = await extractVideoFrames(moveSrc, task.signal, [localTime]);
      if (frame) {
        previews[index] = { ...frame, time: move.segment.start_s };
        publish();
        writeThumb(thumbKey, frame.image);
      }
    })).then(() => {
      if (!task.signal.aborted && !previews.some(Boolean)) setUnavailable(frameKey);
    });
    return () => task.abort();
  }, [previewSrc, timestamps, frameKey, moves, analysis]);
  const frames = decoded.src === frameKey ? decoded.frames : [];
  const moveAt = (time: number) => moves?.find((move) => move.segment.start_s === time);
  return (
    <section
      className={`timeline ${detailed ? "timeline-detailed" : ""}`}
      aria-label="Playback controls"
      hidden={!src}
    >
      <div className="scrub-line">
        <time>{timecode(playback.time)}</time>
        <input
          aria-label="Video timeline"
          type="range"
          min="0"
          max={playback.duration || 0.01}
          step={1 / fps}
          value={Math.min(playback.time, playback.duration || 0)}
          onChange={(event) => seek(Number(event.target.value), true)}
        />
        <time>{timecode(playback.duration)}</time>
      </div>
      <div className="transport">
        <div className="transport-side">
          <span>
            {presentation?.label ||
              media.fileName?.replace(/\.[^.]+$/, "") ||
              "Your footage"}
          </span>
        </div>
        <div className="transport-main">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous frame"
            title="Previous frame"
            disabled={!playback.ready}
            onClick={() => seek(playback.time - 1 / fps, true)}
          >
            <Icon name="prev" />
          </button>
          <button
            type="button"
            className="icon-button play-button"
            aria-label={playback.playing ? "Pause footage" : "Play footage"}
            disabled={!playback.ready}
            onClick={togglePlay}
          >
            <Icon name={playback.playing ? "pause" : "play"} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next frame"
            title="Next frame"
            disabled={!playback.ready}
            onClick={() => seek(playback.time + 1 / fps, true)}
          >
            <Icon name="next" />
          </button>
        </div>
        <div className="transport-side transport-end">
          <button type="button" className="icon-button" aria-label="Replay footage" title="Replay footage" disabled={!playback.ready} onClick={() => {
            seek(0);
            if (!playback.playing) togglePlay();
          }}><Icon name="replay" /></button>
          <button
            type="button"
            className="icon-button"
            aria-label={playback.muted ? "Unmute footage" : "Mute footage"}
            onClick={toggleMuted}
          >
            <Icon name={playback.muted ? "muted" : "sound"} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Full screen"
            // PersistentStage owns the stage, so it handles entering full screen.
            onClick={() => window.dispatchEvent(new Event("footage-fullscreen"))}
          >
            <Icon name="expand" />
          </button>
        </div>
      </div>
      <div className="frame-strip" hidden={!detailed} aria-label="Key frames">
        {frames.map((frame, index) => {
          const move = moveAt(frame.time);
          return (
          <button
            type="button"
            key={`${frame.time}:${index}`}
            title={move ? elementName(move) : undefined}
            aria-label={`${move ? elementName(move) : "Freeze frame"} at ${timecode(frame.time)}`}
            aria-pressed={
              Math.abs(playback.time + (presentation?.offset || 0) - frame.time) < playback.duration / 7 / 2
            }
            onClick={() => {
              if (!move) { seek(Math.round(frame.time * fps) / fps, true); return; }
              setMoveError("");
              void selectMove(move.n).catch((error) => { if (error?.name !== "AbortError") setMoveError("Could not load this skater crop. Try the frame again."); });
            }}
          >
            <Image
              unoptimized
              width={220}
              height={164}
              src={frame.image}
              alt={`Frame ${index + 1}`}
            />
            {move && <span className="frame-element-name" title={elementName(move)}>{elementName(move)}</span>}
            <span>{timecode(frame.time)}</span>
          </button>
          );
        })}
        {!frames.length && <p className="quiet" role="status">{unavailable === frameKey ? "Frame previews are unavailable. You can still use the video timeline." : "Preparing frame previews…"}</p>}
      </div>
      {moveError && <p className="quiet" role="alert">{moveError}</p>}
    </section>
  );
}
