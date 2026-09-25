// 1. EXECUTION GUARD: Prevents duplicate scripts from spawning if Ctrl+Tab or other triggers run it again
if (window.__VIDEO_AUTOMATOR_RUNNING__) {
  console.warn(
    "⚠️ Automator is already running on this page. Aborting duplicate execution.",
  );
} else {
  window.__VIDEO_AUTOMATOR_RUNNING__ = true;

  // 2. Reusable delay helper for async/await
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const video = document.querySelector("video");
  if (video && video.paused) video.play();

  (async () => {
    if (!video) {
      console.error("❌ No video element found on this page.");
      window.__VIDEO_AUTOMATOR_RUNNING__ = false; // Reset guard if failed
      return;
    }

    // --- AUDIO CHECK & AUTO-MUTE ---
    const hasAudioTrack = video.audioTracks && video.audioTracks.length > 0;
    const hasAudioAttribute =
      video.hasAttribute("audio") || video.webkitAudioDecodedByteCount > 0;

    if (
      hasAudioTrack ||
      hasAudioAttribute ||
      typeof video.muted !== "undefined"
    ) {
      video.muted = true;
      console.log(
        "🔇 Audio detected or supported. Video has been automatically MUTED.",
      );
    }

    // --- MODE & STATE CONFIGURATION ---
    let activeMode = "SKIP"; // Options: 'SPEED' (Fast-Forward) or 'SKIP' (Frame Skipping)
    let isWaitingForBuffer = false;
    let isPausedManually = false;

    const FAST_FORWARD_SPEED = 4.0; // Playback rate for SPEED mode
    const NORMAL_SPEED = 1.0;

    // --- THROTTLE CONFIGURATION ---
    let lastSkipTime = 0;
    const SKIP_DELAY_MS = 600; // 500 ms delay between frame skips

    // --- UI INDICATOR PILL ---
    const badge = document.createElement("div");
    Object.assign(badge.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      padding: "10px 16px",
      background: "rgba(0, 0, 0, 0.85)",
      color: "#fff",
      fontFamily: "sans-serif",
      fontSize: "13px",
      borderRadius: "8px",
      zIndex: "999999",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      pointerEvents: "none",
      lineHeight: "1.5",
    });
    document.body.appendChild(badge);

    const updateUI = (bufferSecs = 0) => {
      let modeLabel =
        activeMode === "SPEED" ? "⚡ Smooth Fast-Forward" : "⏩ Frame Skipping";
      let statusLabel = isPausedManually
        ? "⏸️ Manually Paused"
        : isWaitingForBuffer
          ? "⏳ Buffering..."
          : "▶️ Active";
      badge.innerHTML = `
                <div><strong>Mode:</strong> ${modeLabel} <span style="font-size:10px;color:#aaa;">('T' to Toggle)</span></div>
                <div><strong>Status:</strong> ${statusLabel}
                <div><strong>Buffer:</strong> ${bufferSecs.toFixed(1)}s ahead</div>
            `;
    };
    updateUI();

    console.log("⏳ Initialized. Waiting 10 seconds before starting loop...");
    await delay(10000);

    console.log("Loop active.");
    console.log("🛑 DESTROY: Press 'D' or RIGHT-CLICK.");
    console.log("⏸️ PAUSE/RESUME: Press 'P' or MIDDLE-CLICK.");
    console.log(
      "⌨️ MODE TOGGLE: Press 'T' to switch between SPEED and SKIP modes.",
    );

    // 3. The Automation Loop
    const automationLoop = setInterval(() => {
      if (video.ended) {
        cleanup();
        console.log("Video finished! Loop cleared.");
        return;
      }

      let bufferAhead = 0;
      if (video.buffered.length > 0) {
        const currentBufferEnd = video.buffered.end(video.buffered.length - 1);
        bufferAhead = currentBufferEnd - video.currentTime;

        if (isWaitingForBuffer) {
          if (bufferAhead >= 35) {
            isWaitingForBuffer = false;
            console.log(
              `▶️ Buffer healthy (${bufferAhead.toFixed(1)}s). Resuming automation.`,
            );
          }
        } else {
          if (bufferAhead < 25) {
            isWaitingForBuffer = true;
            console.log(
              `⏳ Buffer low (${bufferAhead.toFixed(1)}s). Throttling automation...`,
            );
          }
        }
      }

      updateUI(bufferAhead);

      const canExecute =
        !video.paused &&
        !video.seeking &&
        !isWaitingForBuffer &&
        !isPausedManually;

      if (activeMode === "SPEED") {
        if (canExecute) {
          if (video.playbackRate !== FAST_FORWARD_SPEED)
            video.playbackRate = FAST_FORWARD_SPEED;
        } else {
          if (video.playbackRate !== NORMAL_SPEED)
            video.playbackRate = NORMAL_SPEED;
        }
      } else {
        if (video.playbackRate !== NORMAL_SPEED)
          video.playbackRate = NORMAL_SPEED;

        if (canExecute) {
          const now = Date.now();
          if (now - lastSkipTime >= SKIP_DELAY_MS) {
            video.focus();
            const rightArrowEvent = new KeyboardEvent("keydown", {
              key: "ArrowRight",
              code: "ArrowRight",
              keyCode: 39,
              bubbles: true,
              cancelable: true,
            });
            video.dispatchEvent(rightArrowEvent);
            lastSkipTime = now;
          }
        }
      }
    }, 100);

    // 4. Mouse Trigger Event Handler
    const handleMouseClicks = (event) => {
      if (event.button === 1 || event.button === 3 || event.button === 4) {
        event.preventDefault();
        togglePause();
      }

      if (event.button === 2) {
        event.preventDefault();
        destroyAutomator();
      }
    };

    // 5. Keyboard Mode Toggle & Actions Listener
    const handleKeyPress = (event) => {
      const key = event.key.toLowerCase();

      if (key === "t") {
        activeMode = activeMode === "SPEED" ? "SKIP" : "SPEED";
        if (activeMode === "SKIP" && video.playbackRate !== NORMAL_SPEED) {
          video.playbackRate = NORMAL_SPEED;
        }
        updateUI();
        console.log(
          `🔄 Mode switched! Now using: ${activeMode === "SPEED" ? "Fast-Forward (Speed)" : "Frame Skipping (Skip)"}`,
        );
      }

      if (key === "p") {
        togglePause();
      }

      if (key === "d") {
        destroyAutomator();
      }
    };

    // Helper Actions to keep key/mouse events synchronized
    const togglePause = () => {
      isPausedManually = !isPausedManually;
      updateUI();
      console.log(
        isPausedManually
          ? "⏸️ Automation manually PAUSED."
          : "▶️ Automation manually RESUMED.",
      );
    };

    const destroyAutomator = () => {
      cleanup();
      console.log("🛑 Automation DESTROYED.");
    };

    // 6. Cleanup Function (Resets the guard variable so it can be re-run manually if needed)
    const cleanup = () => {
      clearInterval(automationLoop);
      window.removeEventListener("mousedown", handleMouseClicks);
      window.removeEventListener("keydown", handleKeyPress);
      if (badge) badge.remove();
      if (video) video.playbackRate = NORMAL_SPEED;
      window.__VIDEO_AUTOMATOR_RUNNING__ = false;
    };

    // Attach Listeners
    window.addEventListener("mousedown", handleMouseClicks);
    window.addEventListener("keydown", handleKeyPress);
  })();
}
