"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { streamMockReply } from "@/lib/mock-coach";

type Message = { role: "coach" | "user"; text: string };

/** Bottom-sheet coach chat. Slides up on open; swipe the handle down to close. */
export function CoachChat({ prompt, onClose }: { prompt: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const viewport = useVisualViewport();
  const abortRef = useRef<AbortController | null>(null);

  async function send(text: string) {
    text = text.trim();
    if (!text || streaming) return;
    setDraft("");
    setStreaming(true);
    setMessages((current) => [...current, { role: "user", text }, { role: "coach", text: "" }]);
    abortRef.current = new AbortController();
    for await (const chunk of streamMockReply(text, abortRef.current.signal)) {
      setMessages((current) => {
        const last = current[current.length - 1];
        return [...current.slice(0, -1), { ...last, text: last.text + chunk }];
      });
    }
    setStreaming(false);
  }

  useEffect(() => {
    // Deferred so React StrictMode's mount/unmount/mount only sends once.
    const timer = setTimeout(() => send(prompt), 0);
    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Drag down from the header, or from the thread once it is scrolled to the top.
  function dragStart(y: number, fromHeader: boolean) {
    if (fromHeader || (threadRef.current?.scrollTop ?? 0) <= 0) startY.current = y;
  }
  function dragMove(y: number) {
    if (startY.current !== null) setDragY(Math.max(0, y - startY.current));
  }
  function dragEnd() {
    if (startY.current === null) return;
    startY.current = null;
    if (dragY > 100) onClose();
    else setDragY(0);
  }

  return createPortal(
    <div
      className={`coach-chat-backdrop${viewport.keyboard ? " has-keyboard" : ""}`}
      style={viewport.height ? { top: viewport.top, height: viewport.height, bottom: "auto" } : undefined}
      onClick={onClose}
    >
      <section
        className="coach-chat"
        role="dialog"
        aria-label="Chat with coach"
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => dragStart(event.touches[0].clientY, false)}
        onTouchMove={(event) => dragMove(event.touches[0].clientY)}
        onTouchEnd={dragEnd}
        onMouseMove={(event) => dragMove(event.clientY)}
        onMouseUp={dragEnd}
        onMouseLeave={dragEnd}
      >
        <header
          className="coach-chat-header"
          onTouchStart={(event) => dragStart(event.touches[0].clientY, true)}
          onMouseDown={(event) => dragStart(event.clientY, true)}
        >
          <span className="coach-chat-handle" />
          <p>AI Coach</p>
          <small>{streaming ? "typing…" : "Online"}</small>
        </header>
        <div ref={threadRef} className="coach-chat-thread">
          {messages.map((message, index) => (
            <p key={index} className={`coach-chat-bubble is-${message.role}`}>
              {message.text || (
                <span className="coach-chat-dots">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </p>
          ))}
          <div ref={endRef} />
        </div>
        <form
          className="coach-chat-form"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message your coach"
            enterKeyHint="send"
          />
          <button type="submit" aria-label="Send" disabled={streaming || !draft.trim()}>
            ↑
          </button>
        </form>
      </section>
    </div>,
    document.body,
  );
}

/** Track the visible viewport so the sheet stays put above the on-screen keyboard. */
function useVisualViewport() {
  const [state, setState] = useState({ top: 0, height: 0, keyboard: false });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setState({ top: vv.offsetTop, height: vv.height, keyboard: window.innerHeight - vv.height > 120 });
      // iOS scrolls the page to reveal the focused input; undo it so nothing behind shifts.
      window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return state;
}
