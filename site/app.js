(() => {
  "use strict";

  const config = window.CLIMBING_CONFIG || {};
  const supabaseReady =
    typeof window.supabase?.createClient === "function" &&
    typeof config.supabaseUrl === "string" &&
    config.supabaseUrl.startsWith("https://") &&
    !config.supabaseUrl.includes("YOUR_") &&
    typeof config.supabaseAnonKey === "string" &&
    config.supabaseAnonKey.length > 20 &&
    !config.supabaseAnonKey.includes("YOUR_");

  const state = {
    activeView: "welcome",
    climbStep: 0,
    totalSteps: 7,
    mediaRecorder: null,
    mediaStream: null,
    recordingChunks: [],
    recordedBlob: null,
    recordedUrl: null,
    recordingStartedAt: 0,
    recordingSeconds: 0,
    recordingTimer: null,
    maxRecordingSeconds: Math.min(Number(config.maxRecordingSeconds) || 180, 300),
    client: null,
    user: null,
    latestNote: null,
    summitAudioUrl: null,
    realtimeChannel: null,
    lastFocusedElement: null,
  };

  const els = {
    views: [...document.querySelectorAll(".view")],
    viewLinks: [...document.querySelectorAll("[data-view-link]")],
    navLinks: [...document.querySelectorAll(".nav-link")],
    startClimb: document.querySelector("#start-climb"),
    holds: [...document.querySelectorAll(".route-hold")],
    climber: document.querySelector("#game-climber"),
    progressLabel: document.querySelector("#progress-label"),
    progressBar: document.querySelector("#progress-bar"),
    guideNumber: document.querySelector("#guide-number"),
    guideTitle: document.querySelector("#guide-title"),
    guideCopy: document.querySelector("#guide-copy"),
    resetClimb: document.querySelector("#reset-climb"),
    summitOverlay: document.querySelector("#summit-overlay"),
    closeSummit: document.querySelector("#close-summit"),
    climbAgain: document.querySelector("#climb-again"),
    summitMessage: document.querySelector("#summit-message"),
    summitPlayer: document.querySelector("#summit-player"),
    summitAudioTitle: document.querySelector("#summit-audio-title"),
    summitAudioMeta: document.querySelector("#summit-audio-meta"),
    summitAudio: document.querySelector("#summit-audio"),
    playSummit: document.querySelector("#play-summit"),
    recordButton: document.querySelector("#record-button"),
    recordingStatus: document.querySelector("#recording-status"),
    recordingTimer: document.querySelector("#recording-timer"),
    waveform: document.querySelector("#waveform"),
    recordHint: document.querySelector("#record-hint"),
    audioPreview: document.querySelector("#audio-preview"),
    discardRecording: document.querySelector("#discard-recording"),
    sendRecording: document.querySelector("#send-recording"),
    accountButton: document.querySelector("#account-button"),
    accountLabel: document.querySelector("#account-label"),
    authOverlay: document.querySelector("#auth-overlay"),
    closeAuth: document.querySelector("#close-auth"),
    authForm: document.querySelector("#auth-form"),
    authEmail: document.querySelector("#auth-email"),
    authPassword: document.querySelector("#auth-password"),
    authMessage: document.querySelector("#auth-message"),
    createAccount: document.querySelector("#create-account"),
    demoCallout: document.querySelector("#demo-callout"),
    toastRegion: document.querySelector("#toast-region"),
  };

  function showView(name) {
    if (!["welcome", "climb", "record"].includes(name)) return;

    if (state.mediaRecorder?.state === "recording" && name !== "record") {
      stopRecording();
    }

    state.activeView = name;
    els.views.forEach((view) => {
      const isCurrent = view.id === `${name}-view`;
      view.hidden = !isCurrent;
      view.classList.toggle("is-active", isCurrent);
    });

    els.navLinks.forEach((link) => {
      const target = link.dataset.viewLink;
      const isCurrent =
        target === name || (target === "welcome" && name === "climb");
      link.classList.toggle("is-active", isCurrent);
      if (isCurrent) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startClimb() {
    resetClimb();
    showView("climb");
    loadSummitNote();
    window.setTimeout(() => {
      els.holds[0]?.focus({ preventScroll: true });
    }, 450);
  }

  function resetClimb() {
    state.climbStep = 0;
    els.holds.forEach((hold, index) => {
      hold.classList.remove("is-complete", "is-next");
      hold.disabled = index !== 0;
      if (index === 0) hold.classList.add("is-next");
    });

    els.climber.style.setProperty("--climber-x", "14%");
    els.climber.style.setProperty("--climber-y", "91%");
    updateClimbUi();
  }

  function climbToHold(hold) {
    const step = Number(hold.dataset.step);
    if (step !== state.climbStep + 1) return;

    hold.classList.remove("is-next");
    hold.classList.add("is-complete");
    hold.disabled = true;
    state.climbStep = step;

    const x = hold.style.getPropertyValue("--x").trim();
    const y = hold.style.getPropertyValue("--y").trim();
    els.climber.classList.add("is-moving");
    els.climber.style.setProperty("--climber-x", x);
    els.climber.style.setProperty("--climber-y", y);

    window.setTimeout(() => {
      els.climber.classList.remove("is-moving");
    }, 800);

    const next = els.holds.find(
      (candidate) => Number(candidate.dataset.step) === step + 1,
    );
    if (next) {
      next.disabled = false;
      next.classList.add("is-next");
      window.setTimeout(() => next.focus({ preventScroll: true }), 820);
    }

    updateClimbUi();

    if (step === state.totalSteps) {
      window.setTimeout(revealSummit, 950);
    }
  }

  function updateClimbUi() {
    const percent = Math.round((state.climbStep / state.totalSteps) * 100);
    els.progressLabel.textContent = `${state.climbStep} of ${state.totalSteps} holds`;
    els.progressBar.style.width = `${percent}%`;
    els.guideNumber.textContent = String(
      Math.min(state.climbStep + 1, state.totalSteps),
    ).padStart(2, "0");

    if (state.climbStep === 0) {
      els.guideTitle.textContent = "Find the glowing hold";
      els.guideCopy.textContent =
        "Tap the hold that pulses. Your climber will follow the route one move at a time.";
    } else if (state.climbStep < state.totalSteps - 1) {
      els.guideTitle.textContent = "Nice move—keep going";
      els.guideCopy.textContent = `${state.totalSteps - state.climbStep} holds left. The voice note is still waiting safely at the summit.`;
    } else if (state.climbStep === state.totalSteps - 1) {
      els.guideTitle.textContent = "The summit is one move away";
      els.guideCopy.textContent =
        "Reach for the golden hold. That final move unlocks the voice note.";
    } else {
      els.guideTitle.textContent = "You made it!";
      els.guideCopy.textContent =
        "Summit reached. Your private voice note is now unlocked.";
    }
  }

  function openDialog(overlay, focusTarget) {
    state.lastFocusedElement = document.activeElement;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => focusTarget?.focus(), 50);
  }

  function closeDialog(overlay) {
    overlay.hidden = true;
    document.body.style.overflow = "";
    state.lastFocusedElement?.focus?.();
  }

  async function revealSummit() {
    await loadSummitNote();
    const hasAudio = Boolean(state.summitAudioUrl);

    if (hasAudio) {
      els.summitAudio.src = state.summitAudioUrl;
      els.playSummit.disabled = false;
      els.summitMessage.textContent =
        "Your voice note is unlocked. Press play when you’re ready.";
      els.summitAudioTitle.textContent = state.latestNote?.sender_label
        ? `A note from ${state.latestNote.sender_label}`
        : "A note from your person";
      els.summitAudioMeta.textContent = state.latestNote?.created_at
        ? `Left ${formatRelativeDate(state.latestNote.created_at)}`
        : "Waiting at the top";
    } else {
      els.summitAudio.removeAttribute("src");
      els.playSummit.disabled = true;
      els.summitMessage.textContent =
        "The summit is open, but no voice note is waiting yet. Record one in “Leave a voice” and climb again.";
      els.summitAudioTitle.textContent = "No note waiting yet";
      els.summitAudioMeta.textContent = supabaseReady
        ? "Ask your person to leave one"
        : "Demo mode · record one first";
    }

    openDialog(els.summitOverlay, hasAudio ? els.playSummit : els.climbAgain);
    if (hasAudio && state.latestNote?.id && state.user) {
      markNoteListened(state.latestNote.id);
    }
  }

  function formatRelativeDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "recently";
    const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (diffMinutes < 2) return "just now";
    if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    const diffDays = Math.round(diffHours / 24);
    return diffDays === 1 ? "yesterday" : `${diffDays} days ago`;
  }

  async function toggleSummitAudio() {
    if (!state.summitAudioUrl) return;
    if (els.summitAudio.paused) {
      try {
        await els.summitAudio.play();
      } catch {
        showToast("Your browser could not play this audio.", true);
      }
    } else {
      els.summitAudio.pause();
    }
  }

  function updateSummitPlayState() {
    const isPlaying = !els.summitAudio.paused;
    els.playSummit.classList.toggle("is-playing", isPlaying);
    els.summitPlayer.classList.toggle("is-playing", isPlaying);
    els.playSummit.setAttribute(
      "aria-label",
      isPlaying ? "Pause summit voice note" : "Play summit voice note",
    );
  }

  function preferredMimeType() {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/webm",
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  async function toggleRecording() {
    if (state.mediaRecorder?.state === "recording") {
      stopRecording();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showToast("Audio recording is not supported in this browser.", true);
      return;
    }

    discardRecording(false);

    try {
      state.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const mimeType = preferredMimeType();
      state.mediaRecorder = mimeType
        ? new MediaRecorder(state.mediaStream, { mimeType })
        : new MediaRecorder(state.mediaStream);
      state.recordingChunks = [];

      state.mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) state.recordingChunks.push(event.data);
      });
      state.mediaRecorder.addEventListener("stop", finishRecording, {
        once: true,
      });
      state.mediaRecorder.addEventListener("error", () => {
        showToast("The recording stopped unexpectedly.", true);
        resetRecorderControls();
      });

      state.recordingStartedAt = Date.now();
      state.recordingSeconds = 0;
      state.mediaRecorder.start(1000);
      state.recordingTimer = window.setInterval(updateRecordingTimer, 250);
      setRecordingUi(true);
    } catch (error) {
      const blocked =
        error?.name === "NotAllowedError" || error?.name === "SecurityError";
      showToast(
        blocked
          ? "Microphone access was blocked. Allow it in your browser settings."
          : "The microphone could not be opened.",
        true,
      );
      resetRecorderControls();
    }
  }

  function updateRecordingTimer() {
    state.recordingSeconds = Math.floor(
      (Date.now() - state.recordingStartedAt) / 1000,
    );
    els.recordingTimer.textContent = formatDuration(state.recordingSeconds);
    if (state.recordingSeconds >= state.maxRecordingSeconds) {
      stopRecording();
      showToast("Maximum recording length reached.");
    }
  }

  function stopRecording() {
    if (state.mediaRecorder?.state === "recording") {
      state.mediaRecorder.stop();
    }
    window.clearInterval(state.recordingTimer);
    state.recordingTimer = null;
    state.mediaStream?.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
    setRecordingUi(false);
  }

  function finishRecording() {
    const mimeType =
      state.mediaRecorder?.mimeType ||
      state.recordingChunks[0]?.type ||
      "audio/webm";
    state.recordedBlob = new Blob(state.recordingChunks, { type: mimeType });

    if (state.recordedBlob.size < 800) {
      showToast("That recording was too short. Try again.", true);
      discardRecording(false);
      return;
    }

    if (state.recordedUrl) URL.revokeObjectURL(state.recordedUrl);
    state.recordedUrl = URL.createObjectURL(state.recordedBlob);
    els.audioPreview.src = state.recordedUrl;
    els.audioPreview.hidden = false;
    els.discardRecording.disabled = false;
    els.sendRecording.disabled = false;
    els.recordingStatus.classList.remove("is-live");
    els.recordingStatus.innerHTML = "<i aria-hidden=\"true\"></i> Ready to send";
    els.recordHint.textContent = "Listen first, then hide it at the summit";
  }

  function setRecordingUi(isRecording) {
    els.recordButton.classList.toggle("is-live", isRecording);
    els.recordButton.setAttribute(
      "aria-label",
      isRecording ? "Stop recording" : "Start recording",
    );
    els.recordingStatus.classList.toggle("is-live", isRecording);
    els.waveform.classList.toggle("is-live", isRecording);
    els.recordingStatus.innerHTML = isRecording
      ? "<i aria-hidden=\"true\"></i> Recording"
      : "<i aria-hidden=\"true\"></i> Processing";
    els.recordHint.textContent = isRecording
      ? "Tap the square when you’re done"
      : "Preparing your preview…";
    els.discardRecording.disabled = isRecording || !state.recordedBlob;
    els.sendRecording.disabled = isRecording || !state.recordedBlob;
  }

  function resetRecorderControls() {
    window.clearInterval(state.recordingTimer);
    state.recordingTimer = null;
    state.mediaStream?.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
    state.mediaRecorder = null;
    els.recordButton.classList.remove("is-live");
    els.waveform.classList.remove("is-live");
    els.recordingStatus.classList.remove("is-live");
    els.recordingStatus.innerHTML =
      "<i aria-hidden=\"true\"></i> Ready to record";
    els.recordingTimer.textContent = "00:00";
    els.recordHint.textContent = `Tap to start · Up to ${Math.round(
      state.maxRecordingSeconds / 60,
    )} minutes`;
  }

  function discardRecording(showMessage = true) {
    if (state.mediaRecorder?.state === "recording") stopRecording();
    if (state.recordedUrl) URL.revokeObjectURL(state.recordedUrl);
    state.recordedBlob = null;
    state.recordedUrl = null;
    state.recordingChunks = [];
    els.audioPreview.pause();
    els.audioPreview.removeAttribute("src");
    els.audioPreview.hidden = true;
    els.discardRecording.disabled = true;
    els.sendRecording.disabled = true;
    resetRecorderControls();
    if (showMessage) showToast("Recording discarded.");
  }

  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.max(0, seconds % 60);
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function extensionForMime(mimeType) {
    if (mimeType.includes("mp4")) return "m4a";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    return "webm";
  }

  async function sendRecording() {
    if (!state.recordedBlob) return;

    els.sendRecording.disabled = true;
    const originalText = els.sendRecording.querySelector("span");
    originalText.textContent = "Hiding your note…";

    try {
      if (!supabaseReady || !state.client) {
        saveDemoRecording();
        return;
      }

      if (!state.user) {
        showToast("Sign in before sending a private voice note.", true);
        openAuth();
        return;
      }

      const { data: profile, error: profileError } = await state.client
        .from("profiles")
        .select("partner_id")
        .eq("id", state.user.id)
        .single();

      if (profileError) throw profileError;
      if (!profile?.partner_id) {
        throw new Error(
          "Your two accounts are not paired yet. Complete the pairing step in the setup guide.",
        );
      }

      const extension = extensionForMime(state.recordedBlob.type);
      const fileName = `${crypto.randomUUID()}.${extension}`;
      const filePath = `${state.user.id}/${profile.partner_id}/${fileName}`;

      const { error: uploadError } = await state.client.storage
        .from("voice-notes")
        .upload(filePath, state.recordedBlob, {
          cacheControl: "3600",
          contentType: state.recordedBlob.type || "audio/webm",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error: insertError } = await state.client.from("voice_notes").insert({
        sender_id: state.user.id,
        recipient_id: profile.partner_id,
        file_path: filePath,
        duration_seconds: Math.max(1, state.recordingSeconds),
      });

      if (insertError) {
        await state.client.storage.from("voice-notes").remove([filePath]);
        throw insertError;
      }

      showToast("Voice note hidden at your person’s summit.");
      discardRecording(false);
      showView("welcome");
    } catch (error) {
      showToast(error?.message || "The voice note could not be sent.", true);
    } finally {
      originalText.textContent = "Hide at the summit";
      els.sendRecording.disabled = !state.recordedBlob;
    }
  }

  function saveDemoRecording() {
    if (state.summitAudioUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(state.summitAudioUrl);
    }
    state.summitAudioUrl = URL.createObjectURL(state.recordedBlob);
    state.latestNote = {
      id: "demo-note",
      sender_label: "your demo recording",
      created_at: new Date().toISOString(),
    };
    showToast("Demo note hidden! Climb the wall to unlock it.");
    discardRecording(false);
    showView("welcome");
  }

  function openAuth() {
    els.authMessage.textContent = supabaseReady
      ? ""
      : "Connect Supabase in config.js before creating private accounts.";
    els.demoCallout.hidden = supabaseReady;
    openDialog(els.authOverlay, els.authEmail);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!supabaseReady || !state.client) {
      els.authMessage.textContent =
        "Supabase is not connected yet. Follow the setup guide first.";
      return;
    }

    els.authMessage.textContent = "Signing in…";
    const { error } = await state.client.auth.signInWithPassword({
      email: els.authEmail.value.trim(),
      password: els.authPassword.value,
    });

    if (error) {
      els.authMessage.textContent = error.message;
      return;
    }

    els.authMessage.textContent = "";
    els.authForm.reset();
    closeDialog(els.authOverlay);
    showToast("Signed in. Your private summit is ready.");
  }

  async function createAccount() {
    if (!supabaseReady || !state.client) {
      els.authMessage.textContent =
        "Supabase is not connected yet. Follow the setup guide first.";
      return;
    }

    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    if (!email || password.length < 8) {
      els.authMessage.textContent =
        "Enter an email and a password with at least 8 characters.";
      return;
    }

    els.authMessage.textContent = "Creating your account…";
    const { data, error } = await state.client.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: email.split("@")[0] },
      },
    });

    if (error) {
      els.authMessage.textContent = error.message;
      return;
    }

    els.authMessage.textContent = data.session
      ? "Account created. Pair both accounts using the setup guide."
      : "Check your email to confirm the account, then come back to sign in.";
  }

  async function signOut() {
    if (!state.client) return;
    const confirmed = window.confirm("Sign out of this private climbing wall?");
    if (!confirmed) return;
    await state.client.auth.signOut();
    showToast("Signed out.");
  }

  async function initSupabase() {
    if (!supabaseReady) {
      updateAccountUi();
      return;
    }

    state.client = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );

    const {
      data: { session },
    } = await state.client.auth.getSession();
    await applySession(session);

    state.client.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => applySession(nextSession), 0);
    });
  }

  async function applySession(session) {
    state.user = session?.user || null;
    updateAccountUi();

    if (state.realtimeChannel && state.client) {
      await state.client.removeChannel(state.realtimeChannel);
      state.realtimeChannel = null;
    }

    if (!state.user) {
      if (state.summitAudioUrl && !state.summitAudioUrl.startsWith("blob:")) {
        state.summitAudioUrl = null;
      }
      state.latestNote = null;
      return;
    }

    await loadSummitNote();
    state.realtimeChannel = state.client
      .channel(`summit-notes-${state.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "voice_notes",
          filter: `recipient_id=eq.${state.user.id}`,
        },
        () => {
          loadSummitNote();
          showToast("A new voice note is waiting at your summit.");
        },
      )
      .subscribe();
  }

  function updateAccountUi() {
    if (state.user) {
      const shortEmail = state.user.email?.split("@")[0] || "Signed in";
      els.accountLabel.textContent = shortEmail;
      els.accountButton.classList.add("is-signed-in");
      els.accountButton.setAttribute("aria-label", `Signed in as ${shortEmail}. Sign out`);
    } else {
      els.accountLabel.textContent = supabaseReady ? "Sign in" : "Demo mode";
      els.accountButton.classList.remove("is-signed-in");
      els.accountButton.setAttribute(
        "aria-label",
        supabaseReady ? "Sign in" : "Open demo mode information",
      );
    }
  }

  async function loadSummitNote() {
    if (!state.client || !state.user) return state.latestNote;
    try {
      const { data: note, error } = await state.client
        .from("voice_notes")
        .select("id, sender_id, file_path, duration_seconds, created_at, listened_at")
        .eq("recipient_id", state.user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;

      if (!note) {
        state.latestNote = null;
        state.summitAudioUrl = null;
        return null;
      }

      const { data: signed, error: signedError } = await state.client.storage
        .from("voice-notes")
        .createSignedUrl(note.file_path, 3600);
      if (signedError) throw signedError;

      state.latestNote = note;
      state.summitAudioUrl = signed.signedUrl;
      return note;
    } catch (error) {
      console.error("Could not load summit note:", error);
      return null;
    }
  }

  async function markNoteListened(noteId) {
    if (!state.client || !state.user || noteId === "demo-note") return;
    const { error } = await state.client
      .from("voice_notes")
      .update({ listened_at: new Date().toISOString() })
      .eq("id", noteId)
      .eq("recipient_id", state.user.id);
    if (error) console.error("Could not mark note as listened:", error);
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " is-error" : ""}`;
    toast.textContent = message;
    els.toastRegion.append(toast);
    window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      window.setTimeout(() => toast.remove(), 250);
    }, 4300);
  }

  function bindEvents() {
    els.viewLinks.forEach((link) => {
      link.addEventListener("click", () => {
        const target = link.dataset.viewLink;
        if (target === "climb") startClimb();
        else showView(target);
      });
    });
    els.startClimb.addEventListener("click", startClimb);
    els.holds.forEach((hold) => {
      hold.addEventListener("click", () => climbToHold(hold));
    });
    els.resetClimb.addEventListener("click", resetClimb);
    els.closeSummit.addEventListener("click", () =>
      closeDialog(els.summitOverlay),
    );
    els.climbAgain.addEventListener("click", () => {
      closeDialog(els.summitOverlay);
      resetClimb();
    });
    els.playSummit.addEventListener("click", toggleSummitAudio);
    els.summitAudio.addEventListener("play", updateSummitPlayState);
    els.summitAudio.addEventListener("pause", updateSummitPlayState);
    els.summitAudio.addEventListener("ended", updateSummitPlayState);
    els.recordButton.addEventListener("click", toggleRecording);
    els.discardRecording.addEventListener("click", () => discardRecording(true));
    els.sendRecording.addEventListener("click", sendRecording);
    els.accountButton.addEventListener("click", () => {
      if (state.user) signOut();
      else openAuth();
    });
    els.closeAuth.addEventListener("click", () => closeDialog(els.authOverlay));
    els.authForm.addEventListener("submit", handleAuthSubmit);
    els.createAccount.addEventListener("click", createAccount);

    [els.summitOverlay, els.authOverlay].forEach((overlay) => {
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeDialog(overlay);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!els.authOverlay.hidden) closeDialog(els.authOverlay);
      else if (!els.summitOverlay.hidden) closeDialog(els.summitOverlay);
    });

    window.addEventListener("beforeunload", () => {
      state.mediaStream?.getTracks().forEach((track) => track.stop());
      if (state.recordedUrl) URL.revokeObjectURL(state.recordedUrl);
      if (state.summitAudioUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(state.summitAudioUrl);
      }
    });
  }

  bindEvents();
  resetClimb();
  resetRecorderControls();
  initSupabase().catch((error) => {
    console.error("Supabase initialization failed:", error);
    showToast("Private sharing could not be initialized.", true);
  });
})();
