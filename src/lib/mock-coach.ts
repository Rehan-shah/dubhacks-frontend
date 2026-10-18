const replies: Array<[RegExp, string]> = [
  [/tell me more|more detail|explain|break(?: it)? down|why/i, `Here's the breakdown from your recent clips:

• Takeoff: edge hold averaged 0.21s before the pick, up from 0.16s. That's the main reason your jumps are more consistent now.
• Air position: your free leg is uncrossed for about 22% of rotation time. Elite skaters are under 10%. This costs you roughly a quarter turn of speed.
• Rotation: peak rotation speed is about 4.6 rev/s, steady from clip to clip (±0.2). Your shoulders open about 40ms early on the last turn.
• Landing: hips stay within 12° of square on 4 of 5 clean landings. On the one that wasn't clean, the free leg came down first.

What I'd do next: work on air position. Getting the free leg uncrossed time under 15% should add close to a quarter turn and make your landings cleaner. Want me to build a 2-week drill block around that?`],
  [/focus|next|improv/i, "Nice progress! Your biggest gain next is air position. Keep the free leg crossed tight and the upper body quiet through the last rotation. This week, try 3 sets of jump-and-hold drills off-ice before each session."],
  [/free leg|leg/i, "Your free leg drops about a quarter turn early. Hold it crossed over the landing leg until you feel the ice, then extend into the exit."],
  [/takeoff|toe ?pick|lutz|jump/i, "Takeoffs are getting more consistent. Stay on the edge a beat longer and let the pick do the work instead of pre-rotating with your shoulders."],
  [/land|fall/i, "Landings look stable when your hips stay square. Check out with your arms extended and hold the exit edge for two full counts."],
  [/shoulder|rotat|spin/i, "Rotation speed is solid. Your shoulders open slightly early, so focus on a quick, tight pull-in right after takeoff."],
  [/plan|drill|week|practice/i, "Here's the plan: Air Position Hold (3 sets), then Landing Stability (3 sets), then 5–10 full attempts once both feel automatic."],
  [/^(hi|hey|hello)\b/i, "Hey! I've looked through your recent clips. Ask me anything about takeoff, air position, or landing."],
];

const fallback =
  "Good question. Across your recent clips, I think the biggest win is holding your air position: keep the free leg higher and the upper body quiet. Want a drill for that?";

/** Stream a canned coach reply word by word, mimicking a live model response. */
export async function* streamMockReply(question: string, signal?: AbortSignal) {
  const reply = replies.find(([pattern]) => pattern.test(question))?.[1] ?? fallback;
  await new Promise((resolve) => setTimeout(resolve, 600));
  for (const word of reply.split(/(\s+)/)) {
    if (signal?.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 50));
    yield word;
  }
}
