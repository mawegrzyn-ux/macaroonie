// The rules of one listening, kept apart from App.js (no React Native here)
// so the tests can run them in Node. App.js feeds a session the recogniser's
// events (expo-speech-recognition) and passes on what it says.
//
// Continuous listening (Android 13 and up) keeps the microphone open through
// pauses until the page calls stop(): each pause's words arrive as a final
// result of their own and the partial results after it hold only the new
// words, so a session joins them. Without it each result holds every word.
//
// Android reports some endings as errors that only mean "stopped, nothing
// more to hear": a stop() when nothing new was said (client, "Other client
// side errors."), silence (no-speech, speech-timeout), an abort. Those are
// never shown. If continuous listening ends with an error before the page
// asked it to stop, the phone's recogniser can't do it: the app listens the
// ordinary way from then on (the page starts it again on each pause).

export const QUIET_ERRORS = new Set(['no-speech', 'aborted', 'client', 'speech-timeout'])

export function createSession({ continuous = false } = {}) {
  let said = ''
  let stopping = false
  let failed = false
  return {
    continuous: !!continuous,
    /** A result: the words so far of this listening. */
    text(transcript, final) {
      const t = String(transcript || '').trim()
      if (!continuous) return t
      const all = [said, t].filter(Boolean).join(' ')
      if (final) said = all
      return all
    },
    /** An error: whether to show it to the person. */
    error(code) {
      if (!stopping) failed = true
      return !QUIET_ERRORS.has(code)
    },
    /** The page asked to stop. */
    stop() { stopping = true },
    /** The end: whether continuous listening should be dropped for this run of the app. */
    end() { return !!continuous && failed && !stopping },
  }
}
