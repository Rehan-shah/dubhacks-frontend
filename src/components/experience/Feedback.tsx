"use client";
import { useEffect, useRef, useState } from "react";
import { useAnalysis } from "@/components/api/AnalysisProvider";
import { useSessionMedia } from "@/components/media/SessionMedia";
import { skateApi } from "@/lib/api";
import type { Analysis, MoveDetail } from "@/types/api";
import { Icon } from "./Icons";
import { elementName } from "@/lib/element-names";
export function Feedback({ onClose }: { onClose: () => void }) {
  const { analysis, status, error, retry } = useAnalysis();
  return (
    <aside className="feedback" aria-label="AI feedback">
      <div className="feedback-heading">
        <h2>Feedback</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close feedback"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {status === "uploading" || status === "processing" ? (
        <p role="status" className="feedback-copy">
          {status === "uploading"
            ? "Uploading…"
            : "Analyzing…"}
        </p>
      ) : null}
      {error && (
        <p role="alert" className="feedback-copy">
          {error}{" "}
          <button type="button" className="text-action" onClick={retry}>
            Retry analysis
          </button>
        </p>
      )}
      {analysis && <Results key={analysis.analysis_id} analysis={analysis} />}
      {status === "idle" && (
        <p className="feedback-copy">
          Add a video to analyze it.
        </p>
      )}
    </aside>
  );
}
function Results({ analysis }: { analysis: Analysis }) {
  const { seek, showOriginal } = useSessionMedia();
  const [selected, setSelected] = useState(analysis.moves[0]?.n ?? 0);
  const [detail, setDetail] = useState<MoveDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<string[]>([]);
  const cache = useRef(new Map<string, MoveDetail>());
  const move = analysis.moves.find((item) => item.n === selected);
  useEffect(() => {
    if (!move) return;
    const task = new AbortController();
    const key = `${selected}`;
    const cached = cache.current.get(key);
    const load = cached
      ? Promise.resolve(cached)
      : skateApi.move(analysis.analysis_id, selected, "normal", task.signal);
    void load
      .then((result) => {
        if (task.signal.aborted) return;
        cache.current.set(key, result);
        setDetail(result);
        setError("");
      })
      .catch((cause) => {
        if (!task.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load technique details.",
          );
        }
      });
    return () => task.abort();
  }, [analysis.analysis_id, selected, move, attempt]);
  const coaching =
    detail?.move.n === selected
      ? detail.detail
      : analysis.moves.length === 1
        ? analysis.single_move?.detail
        : undefined;
  const currentDetail = detail?.move.n === selected ? detail : null;
  return (
    <>
      <dl className="score-line">
        <div>
          <dt>Score</dt>
          <dd>
            {analysis.score.toFixed(1)}
            <small>/10</small>
          </dd>
        </div>
        <div>
          <dt>TES</dt>
          <dd>{analysis.tes.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Points lost</dt>
          <dd>{analysis.total_points_lost.toFixed(2)}</dd>
        </div>
      </dl>
      <p className="feedback-copy">{analysis.summary.went_right}</p>
      <p className="feedback-copy muted-copy">
        {analysis.summary.could_improve}
      </p>
      {analysis.person_tracking?.warning && (
        <p className="quiet">
          Tracking uses estimated skater positions for this clip.
        </p>
      )}
      {analysis.moves.length > 0 && (
        <label className="move-select">
          Technique
          <select
            aria-label="Select move"
            value={selected}
            onChange={(event) => {
              const n = Number(event.target.value);
              setSelected(n);
              setDetail(null);
              setError("");
              showOriginal();
              const item = analysis.moves.find((m) => m.n === n);
              if (item) seek(item.segment.start_s, true);
            }}
          >
            {analysis.moves.map((item) => (
              <option value={item.n} key={item.n}>
                {elementName(item)}
              </option>
            ))}
          </select>
        </label>
      )}
      {move && (
        <>
          <div className="move-heading">
            <h3>{elementName(move)}</h3>
            <span>
              {move.score.toFixed(1)}
              <small>/10</small>
            </span>
          </div>
          <p className="quiet">
            {move.fall ? "Fall detected · " : ""}
            {move.points_lost.toFixed(2)} points lost
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="feedback-copy">
          {error}{" "}
          <button
            type="button"
            className="text-action"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry details
          </button>
        </p>
      )}
      {currentDetail && (
        <dl className="technique-numbers">
          <div>
            <dt>Base value</dt>
            <dd>{currentDetail.move.bv}</dd>
          </div>
          <div>
            <dt>GOE</dt>
            <dd>{currentDetail.move.goe}</dd>
          </div>
          {currentDetail.move.physics?.air_time_s != null && (
            <div>
              <dt>Air time</dt>
              <dd>{currentDetail.move.physics.air_time_s.toFixed(2)}s</dd>
            </div>
          )}
          {currentDetail.move.physics?.height_m != null && (
            <div>
              <dt>Height</dt>
              <dd>{currentDetail.move.physics.height_m.toFixed(2)}m</dd>
            </div>
          )}
          {currentDetail.move.physics?.revolutions != null && (
            <div>
              <dt>Rotations</dt>
              <dd>{currentDetail.move.physics.revolutions.toFixed(2)}</dd>
            </div>
          )}
        </dl>
      )}
      {coaching ? (
        <>
          <p className="feedback-copy">{coaching.summary}</p>
          {coaching.went_right.length > 0 && (
            <section className="coaching-section">
              <h4>What’s working</h4>
              {coaching.went_right.map((item, index) => (
                <p key={index}>{item}</p>
              ))}
            </section>
          )}
          {coaching.went_wrong.length > 0 && (
            <section className="coaching-section">
              <h4>Issues</h4>
              {coaching.went_wrong.map((item, index) => (
                <p key={index}>
                  {item.issue}
                  <span className="rule-note">{item.rule}</span>
                </p>
              ))}
            </section>
          )}
          {coaching.improvements.length > 0 && (
            <section className="coaching-section">
              <h4>Practice drills</h4>
              {coaching.improvements.map((item, index) => {
                const key = `${selected}:${index}`;
                return (
                  <label className="practice-drill" key={key}>
                    <input
                      type="checkbox"
                      checked={done.includes(key)}
                      onChange={() =>
                        setDone((values) =>
                          values.includes(key)
                            ? values.filter((value) => value !== key)
                            : [...values, key],
                        )
                      }
                    />
                    <span>
                      <strong>{item.fix}</strong>
                      <span>{item.drill}</span>
                      <em>{item.cue}</em>
                    </span>
                  </label>
                );
              })}
            </section>
          )}
        </>
      ) : move && !error ? (
        <p className="quiet" role="status">
          Loading technique details…
        </p>
      ) : null}
    </>
  );
}
