import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type RemoteTrack
} from "livekit-client";
import "./styles.css";

const tokenServerUrl =
  import.meta.env.VITE_TOKEN_SERVER_URL ?? "http://localhost:8787";

function requireElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const roomInput = requireElement<HTMLInputElement>("#room");
const connectButton = requireElement<HTMLButtonElement>("#connect");
const disconnectButton = requireElement<HTMLButtonElement>("#disconnect");
const statusText = requireElement<HTMLParagraphElement>("#status");
const statusDot = requireElement<HTMLSpanElement>("#status-dot");
const remoteAudio = requireElement<HTMLAudioElement>("#remote-audio");

let room: Room | undefined;

roomInput.value = `fish-voice-${crypto.randomUUID().slice(0, 8)}`;

function setStatus(message: string, state: ConnectionState | "error") {
  statusText.textContent = message;
  statusDot.dataset.state = state;
}

function setConnectedControls(isConnected: boolean) {
  connectButton.disabled = isConnected;
  disconnectButton.disabled = !isConnected;
  roomInput.disabled = isConnected;
}

function attachRemoteTrack(track: RemoteTrack) {
  if (track.kind !== Track.Kind.Audio) return;
  track.attach(remoteAudio);
  void remoteAudio.play().catch((error: unknown) => {
    console.warn("remote audio playback did not start automatically", error);
  });
}

async function getToken(roomName: string) {
  const response = await fetch(`${tokenServerUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: roomName })
  });

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status}`);
  }

  return (await response.json()) as {
    identity: string;
    room: string;
    token: string;
    url: string;
  };
}

async function checkFish() {
  const response = await fetch(`${tokenServerUrl}/fish/preflight`);
  if (!response.ok) {
    throw new Error(`Fish preflight failed: ${response.status}`);
  }

  const result = (await response.json()) as {
    ok: boolean;
    credit?: { credit?: string; hasFreeCredit?: boolean };
    plan?: { type?: string; balance?: number };
    voice?: { title?: string; state?: string };
    tts?: { status?: number; message?: string | null };
  };

  if (!result.ok) {
    const detail = result.tts?.message
      ? `Fish TTS ${result.tts.status}: ${result.tts.message}`
      : "Fish TTS preflight failed";
    throw new Error(detail);
  }

  return result;
}

async function connect() {
  const roomName =
    roomInput.value.trim() || `fish-voice-${crypto.randomUUID().slice(0, 8)}`;
  setStatus("Checking Fish Audio", ConnectionState.Connecting);

  await checkFish();
  setStatus("Requesting token", ConnectionState.Connecting);
  const credentials = await getToken(roomName);
  const nextRoom = new Room({
    adaptiveStream: true,
    dynacast: true
  });

  nextRoom
    .on(RoomEvent.ConnectionStateChanged, (state) => {
      setStatus(state, state);
    })
    .on(RoomEvent.ParticipantConnected, (participant) => {
      setStatus(`${participant.identity} joined`, ConnectionState.Connected);
    })
    .on(RoomEvent.TrackSubscribed, (track) => {
      attachRemoteTrack(track);
      setStatus("Receiving agent audio", ConnectionState.Connected);
    })
    .on(RoomEvent.Disconnected, () => {
      setConnectedControls(false);
      setStatus("Disconnected", ConnectionState.Disconnected);
    });

  await nextRoom.connect(credentials.url, credentials.token);

  const micTrack = await createLocalAudioTrack({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  });
  await nextRoom.localParticipant.publishTrack(micTrack, {
    name: "microphone"
  });

  room = nextRoom;
  setConnectedControls(true);
  setStatus(`Connected as ${credentials.identity}`, ConnectionState.Connected);
}

async function disconnect() {
  await room?.disconnect();
  room = undefined;
  setConnectedControls(false);
}

connectButton.addEventListener("click", () => {
  connect().catch((error: unknown) => {
    console.error(error);
    const message = error instanceof Error ? error.message : "Connection failed";
    setStatus(message, "error");
    setConnectedControls(false);
  });
});

disconnectButton.addEventListener("click", () => {
  disconnect().catch((error: unknown) => {
    console.error(error);
    setStatus("Disconnect failed", "error");
  });
});
