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
    character: "man",
    client: null,
    user: null,
    partnerId: null,
    guestInvite: null,
    inviteError: null,
    createdInviteUrl: "",
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
    characterButtons: [...document.querySelectorAll("[data-character]")],
    heroClimber: document.querySelector("#hero-climber"),
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
    recordEyebrow: document.querySelector("#record-eyebrow"),
    recordTitle: document.querySelector("#record-title"),
    recordDescription: document.querySelector("#record-description"),
    recordingStatus: document.querySelector("#recording-status"),
    recordingTimer: document.querySelector("#recording-timer"),
    waveform: document.querySelector("#waveform"),
    recordHint: document.querySelector("#record-hint"),
    audioPreview: document.querySelector("#audio-preview"),
    discardRecording: document.querySelector("#discard-recording"),
    sendRecording: document.querySelector("#send-recording"),
    guestLinkOption: document.querySelector("#guest-link-option"),
    guestLinkMode: document.querySelector("#guest-link-mode"),
    privacyCopy: document.querySelector("#privacy-copy"),
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
    inviteBanner: document.querySelector("#invite-banner"),
    inviteBannerTitle: document.querySelector("#invite-banner-title"),
    inviteBannerCopy: document.querySelector("#invite-banner-copy"),
    inviteOverlay: document.querySelector("#invite-overlay"),
    closeInvite: document.querySelector("#close-invite"),
    inviteUrl: document.querySelector("#invite-url"),
    copyInvite: document.querySelector("#copy-invite"),
    shareInvite: document.querySelector("#share-invite"),
    inviteExpiry: document.querySelector("#invite-expiry"),
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

    if (name === "record") updateRecorderMode();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startClimb() {
    if (state.inviteError) {
      showToast(state.inviteError, true);
      return;
    }
    resetClimb();
    showView("climb");
    loadSummitNote();
    window.setTimeout(() => {
      els.holds[0]?.focus({ preventScroll: true });
    }, 450);
  }

  function setCharacter(character, remember = true) {
    if (!["man", "woman"].includes(character)) return;
    state.character = character;
    const source = `./assets/climber-${character}.png`;
    els.heroClimber.src = source;
    els.heroClimber.alt =
      character === "man"
        ? "An illustrated male climber reaching for the next hold"
        : "An illustrated female climber reaching for the next hold";
    els.climber.src = source;

    els.characterButtons.forEach((button) => {
      const selected = button.dataset.character === character;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });

    if (remember) {
      try {
        window.localStorage.setItem("climbing-character", character);
      } catch {
        // The selector still works when browser storage is unavailable.
      }
    }
  }

  function isAnonymousUser(user = state.user) {
    return Boolean(
      user?.is_anonymous ||
        user?.app_metadata?.provider === "anonymous" ||
        user?.app_metadata?.providers?.includes?.("anonymous"),
    );
  }

  function updateRecorderMode() {
    const buttonText = els.sendRecording.querySelector("span");
    if (state.guestInvite) {
      els.recordEyebrow.innerHTML =
        '<span aria-hidden="true">↩</span> A voice back across the distance';
      els.recordTitle.innerHTML = "Send your voice <em>back down.</em>";
      els.recordDescription.textContent =
        "Record a reply for the person who sent this private climb. It stays inside the same 24-hour invitation.";
      els.guestLinkOption.hidden = true;
      els.privacyCopy.textContent =
        "Your reply is available only through this invitation until it expires.";
      buttonText.textContent = "Send voice reply";
      return;
    }

    els.recordEyebrow.innerHTML =
      '<span aria-hidden="true">♥</span> A surprise for the summit';
    els.recordTitle.innerHTML = "Hide your voice <em>at the top.</em>";
    els.recordDescription.textContent =
      "Record something sweet, silly, or encouraging. Your person will only hear it after finishing the climb.";

    if (state.user && !isAnonymousUser()) {
      els.guestLinkOption.hidden = false;
      if (!state.partnerId) {
        els.guestLinkMode.checked = true;
        els.guestLinkMode.disabled = true;
      } else {
        els.guestLinkMode.disabled = false;
      }
    } else {
      els.guestLinkOption.hidden = true;
    }

    const guestDelivery =
      Boolean(state.user) &&
      !isAnonymousUser() &&
      (els.guestLinkMode.checked || !state.partnerId);
    buttonText.textContent = guestDelivery
      ? "Create private link"
      : "Hide at the summit";
    els.privacyCopy.textContent = guestDelivery
      ? "The guest link works for one person and expires after 24 hours."
      : "Voice notes are private and only available to your paired person.";
  }

  function updateInviteBanner() {
    if (state.inviteError) {
      els.inviteBanner.hidden = false;
      els.inviteBanner.classList.add("is-error");
      els.inviteBannerTitle.textContent = "This guest link is unavailable";
      els.inviteBannerCopy.textContent = state.inviteError;
      return;
    }

    if (!state.guestInvite) {
      els.inviteBanner.hidden = true;
      els.inviteBanner.classList.remove("is-error");
      return;
    }

    const millisecondsLeft =
      new Date(state.guestInvite.expires_at).getTime() - Date.now();
    const hoursLeft = Math.max(1, Math.ceil(millisecondsLeft / 3600000));
    els.inviteBanner.hidden = false;
    els.inviteBanner.classList.remove("is-error");
    els.inviteBannerTitle.textContent = "Private guest invitation";
    els.inviteBannerCopy.textContent = `${hoursLeft} hour${hoursLeft === 1 ? "" : "s"} left · Climb to hear the note, then leave a voice reply.`;
  }

  function createInviteToken() {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return [...bytes]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  async function hashInviteToken(token) {
    const bytes = new TextEncoder().encode(token);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  function inviteTokenFromUrl() {
    const token = new URL(window.location.href).searchParams.get("invite") || "";
    return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : "";
  }

  function clearInviteTokenFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
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

  async function uploadGuestVoiceNote(invite) {
    const extension = extensionForMime(state.recordedBlob.type);
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const filePath = `guest/${invite.id}/${state.user.id}/${fileName}`;

    const { error: uploadError } = await state.client.storage
      .from("voice-notes")
      .upload(filePath, state.recordedBlob, {
        cacheControl: "3600",
        contentType: state.recordedBlob.type || "audio/webm",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { error: insertError } = await state.client
      .from("guest_voice_notes")
      .insert({
        invite_id: invite.id,
        sender_id: state.user.id,
        file_path: filePath,
        duration_seconds: Math.max(1, state.recordingSeconds),
      });

    if (insertError) {
      await state.client.storage.from("voice-notes").remove([filePath]);
      throw insertError;
    }
  }

  function buildInviteUrl(token) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("invite", token);
    return url.toString();
  }

  function showInviteLink(url, expiresAt) {
    state.createdInviteUrl = url;
    els.inviteUrl.value = url;
    const expiry = new Date(expiresAt);
    els.inviteExpiry.textContent = Number.isNaN(expiry.getTime())
      ? "The link expires 24 hours after it is created."
      : `Expires ${expiry.toLocaleString([], {
          dateStyle: "medium",
          timeStyle: "short",
        })}. It can be claimed by one person.`;
    openDialog(els.inviteOverlay, els.copyInvite);
  }

  async function createGuestInviteAndSend() {
    const token = createInviteToken();
    const inviteHash = await hashInviteToken(token);
    const { data, error } = await state.client.rpc("create_guest_invite", {
      invite_hash: inviteHash,
    });
    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.invite_id) {
      throw new Error("The private guest link could not be created.");
    }

    const invite = {
      id: result.invite_id,
      creator_id: state.user.id,
      guest_id: null,
      expires_at: result.invite_expires_at,
    };
    await uploadGuestVoiceNote(invite);
    const inviteUrl = buildInviteUrl(token);

    showToast("Your 24-hour guest link is ready.");
    discardRecording(false);
    showView("welcome");
    showInviteLink(inviteUrl, invite.expires_at);
  }

  async function sendGuestReply() {
    if (new Date(state.guestInvite.expires_at).getTime() <= Date.now()) {
      throw new Error("This private link has expired.");
    }
    await uploadGuestVoiceNote(state.guestInvite);
    showToast("Your voice reply was sent.");
    discardRecording(false);
    showView("welcome");
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

      if (state.guestInvite) {
        await sendGuestReply();
        return;
      }

      if (els.guestLinkMode.checked || !state.partnerId) {
        await createGuestInviteAndSend();
        return;
      }

      const extension = extensionForMime(state.recordedBlob.type);
      const fileName = `${crypto.randomUUID()}.${extension}`;
      const filePath = `${state.user.id}/${state.partnerId}/${fileName}`;

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
        recipient_id: state.partnerId,
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
      updateRecorderMode();
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
    const confirmed = window.confirm(
      state.guestInvite
        ? "Leave this guest invitation? You may not be able to reopen it on this device."
        : "Sign out of this private climbing wall?",
    );
    if (!confirmed) return;
    state.guestInvite = null;
    state.partnerId = null;
    await state.client.auth.signOut();
    updateInviteBanner();
    updateRecorderMode();
    showToast("Signed out.");
  }

  async function restoreGuestInvite(user) {
    if (!user || !isAnonymousUser(user)) return null;
    const { data, error } = await state.client
      .from("guest_invites")
      .select("id, creator_id, guest_id, expires_at")
      .eq("guest_id", user.id)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    state.guestInvite = data;
    return data;
  }

  async function activateGuestInvite(token, session) {
    const inviteHash = await hashInviteToken(token);
    const { data: available, error: availabilityError } = await state.client.rpc(
      "guest_invite_available",
      { invite_hash: inviteHash },
    );
    if (availabilityError) throw availabilityError;
    if (!available) {
      throw new Error(
        "This private link has expired, is invalid, or was already claimed.",
      );
    }

    let activeSession = session;
    if (!activeSession) {
      const { data, error } = await state.client.auth.signInAnonymously({
        options: {
          data: { display_name: "Guest climber" },
        },
      });
      if (error) {
        const anonymousDisabled = /anonymous|provider|disabled/i.test(
          error.message || "",
        );
        throw new Error(
          anonymousDisabled
            ? "Guest access is not enabled yet. Ask the sender to finish the one-time setup."
            : error.message,
        );
      }
      activeSession = data.session;
    }

    const { data, error } = await state.client.rpc("redeem_guest_invite", {
      invite_hash: inviteHash,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.invite_id) {
      throw new Error("This private link could not be opened.");
    }

    state.guestInvite = {
      id: result.invite_id,
      creator_id: result.invite_creator_id,
      guest_id: result.invite_guest_id,
      expires_at: result.invite_expires_at,
    };
    state.inviteError = null;
    clearInviteTokenFromUrl();
    await applySession(activeSession);
    showToast("Private invitation opened. Your summit is ready.");
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

    const url = new URL(window.location.href);
    const rawInviteToken = url.searchParams.get("invite");
    const inviteToken = inviteTokenFromUrl();

    if (rawInviteToken) {
      if (!inviteToken) {
        state.inviteError = "This private link is not valid.";
        updateInviteBanner();
        await applySession(session);
      } else {
        try {
          await activateGuestInvite(inviteToken, session);
        } catch (error) {
          state.inviteError =
            error?.message || "This private link could not be opened.";
          updateInviteBanner();
          await applySession(session);
        }
      }
    } else {
      if (session?.user && isAnonymousUser(session.user)) {
        try {
          await restoreGuestInvite(session.user);
        } catch (error) {
          console.error("Could not restore guest invitation:", error);
        }
      }
      await applySession(session);
    }

    state.client.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => applySession(nextSession), 0);
    });
  }

  async function applySession(session) {
    state.user = session?.user || null;
    state.partnerId = null;

    if (
      state.user &&
      !state.guestInvite &&
      !state.inviteError &&
      isAnonymousUser(state.user)
    ) {
      try {
        await restoreGuestInvite(state.user);
      } catch (error) {
        console.error("Could not restore guest invitation:", error);
      }
    }

    if (state.user && !state.guestInvite && !isAnonymousUser(state.user)) {
      const { data: profile, error } = await state.client
        .from("profiles")
        .select("partner_id")
        .eq("id", state.user.id)
        .maybeSingle();
      if (error) console.error("Could not load profile:", error);
      state.partnerId = profile?.partner_id || null;
      els.guestLinkMode.checked = !state.partnerId;
    }

    updateAccountUi();
    updateInviteBanner();
    updateRecorderMode();

    if (state.realtimeChannel && state.client) {
      await state.client.removeChannel(state.realtimeChannel);
      state.realtimeChannel = null;
    }

    if (!state.user) {
      if (state.summitAudioUrl && !state.summitAudioUrl.startsWith("blob:")) {
        state.summitAudioUrl = null;
      }
      state.latestNote = null;
      state.partnerId = null;
      return;
    }

    await loadSummitNote();
    let channel = state.client.channel(`summit-notes-${state.user.id}`);
    if (state.guestInvite) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "guest_voice_notes",
          filter: `invite_id=eq.${state.guestInvite.id}`,
        },
        (payload) => {
          if (payload.new?.sender_id === state.user.id) return;
          loadSummitNote();
          showToast("A new voice note is waiting at your summit.");
        },
      );
    } else {
      channel = channel
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
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "guest_voice_notes",
          },
          (payload) => {
            if (payload.new?.sender_id === state.user.id) return;
            loadSummitNote();
            showToast("Your guest left a voice reply.");
          },
        );
    }
    state.realtimeChannel = channel.subscribe();
  }

  function updateAccountUi() {
    if (state.user) {
      const shortEmail = state.guestInvite
        ? "24h guest"
        : state.user.email?.split("@")[0] || "Signed in";
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
      let note = null;

      if (!state.guestInvite) {
        const { data, error } = await state.client
          .from("voice_notes")
          .select(
            "id, sender_id, file_path, duration_seconds, created_at, listened_at",
          )
          .eq("recipient_id", state.user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        note = data ? { ...data, source: "pair" } : null;
      }

      let guestQuery = state.client
        .from("guest_voice_notes")
        .select(
          "id, invite_id, sender_id, file_path, duration_seconds, created_at, listened_at",
        )
        .neq("sender_id", state.user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (state.guestInvite) {
        guestQuery = guestQuery.eq("invite_id", state.guestInvite.id);
      }
      const { data: guestData, error: guestError } =
        await guestQuery.maybeSingle();
      if (guestError) throw guestError;
      const guestNote = guestData
        ? {
            ...guestData,
            source: "guest",
            sender_label: state.guestInvite
              ? "the person who sent your invitation"
              : "your guest",
          }
        : null;

      if (
        guestNote &&
        (!note ||
          new Date(guestNote.created_at).getTime() >
            new Date(note.created_at).getTime())
      ) {
        note = guestNote;
      }

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
    const isGuestNote = state.latestNote?.source === "guest";
    let query = state.client
      .from(isGuestNote ? "guest_voice_notes" : "voice_notes")
      .update({ listened_at: new Date().toISOString() })
      .eq("id", noteId);
    query = isGuestNote
      ? query.neq("sender_id", state.user.id)
      : query.eq("recipient_id", state.user.id);
    const { error } = await query;
    if (error) console.error("Could not mark note as listened:", error);
  }

  async function copyInviteLink() {
    if (!state.createdInviteUrl) return;
    try {
      await navigator.clipboard.writeText(state.createdInviteUrl);
    } catch {
      els.inviteUrl.focus();
      els.inviteUrl.select();
      document.execCommand("copy");
    }
    els.copyInvite.textContent = "Copied!";
    showToast("Guest link copied.");
    window.setTimeout(() => {
      els.copyInvite.textContent = "Copy";
    }, 1800);
  }

  async function shareInviteLink() {
    if (!state.createdInviteUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Climbing to You",
          text: "I left a private voice note at the summit. This link works for 24 hours.",
          url: state.createdInviteUrl,
        });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await copyInviteLink();
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
    els.characterButtons.forEach((button) => {
      button.addEventListener("click", () => setCharacter(button.dataset.character));
    });
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
    els.guestLinkMode.addEventListener("change", updateRecorderMode);
    els.accountButton.addEventListener("click", () => {
      if (state.user) signOut();
      else openAuth();
    });
    els.closeAuth.addEventListener("click", () => closeDialog(els.authOverlay));
    els.authForm.addEventListener("submit", handleAuthSubmit);
    els.createAccount.addEventListener("click", createAccount);
    els.closeInvite.addEventListener("click", () =>
      closeDialog(els.inviteOverlay),
    );
    els.copyInvite.addEventListener("click", copyInviteLink);
    els.shareInvite.addEventListener("click", shareInviteLink);

    [els.summitOverlay, els.authOverlay, els.inviteOverlay].forEach((overlay) => {
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeDialog(overlay);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!els.authOverlay.hidden) closeDialog(els.authOverlay);
      else if (!els.inviteOverlay.hidden) closeDialog(els.inviteOverlay);
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
  let savedCharacter = "man";
  try {
    savedCharacter = window.localStorage.getItem("climbing-character") || "man";
  } catch {
    savedCharacter = "man";
  }
  setCharacter(savedCharacter, false);
  resetClimb();
  resetRecorderControls();
  updateRecorderMode();
  updateInviteBanner();
  initSupabase().catch((error) => {
    console.error("Supabase initialization failed:", error);
    showToast("Private sharing could not be initialized.", true);
  });
})();
