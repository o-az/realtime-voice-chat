import {
  Room,
  Track,
  RoomEvent,
  ConnectionState,
  createLocalAudioTrack,
  type RemoteTrack,
  type Participant,
  type LocalAudioTrack,
  type TranscriptionSegment
} from 'livekit-client'
import '#styles.css'

const tokenServerUrl = import.meta.env.VITE_TOKEN_SERVER_URL ?? '/api'
const transcriptStoragePrefix = 'fish-voice-chat:transcript:'
const maxPersistedTranscriptItems = 120

const roomInput = document.querySelector('input#room')
const voiceIdInput = document.querySelector('input#voice-id')
const connectButton = document.querySelector('button#connect')
const disconnectButton = document.querySelector('button#disconnect')
const muteButton = document.querySelector('button#mute')
const statusText = document.querySelector('p#status')
const statusDot = document.querySelector('span#status-dot')
const remoteAudio = document.querySelector('audio#remote-audio')
const transcriptLines = document.querySelector('div#transcript-lines')

let room: Room | undefined
let localMicTrack: LocalAudioTrack | undefined
let micMuted = false
const transcriptItems = new Map<string, TranscriptItem>()

if (!roomInput) throw new Error('Room input is required')
roomInput.value = `fish-voice-${crypto.randomUUID().slice(0, 8)}`

type TranscriptSpeaker = 'you' | 'agent'

type TranscriptItem = {
  id: string
  speaker: TranscriptSpeaker
  text: string
  final: boolean
  receivedAt: number
}

async function loadConfig() {
  const response = await fetch(`${tokenServerUrl}/config`)
  if (!response.ok) return

  // TODO: use zod and properly type this response
  const config = (await response.json()) as {
    defaultFishVoiceId?: string
  }

  if (!voiceIdInput) return

  if (!voiceIdInput?.value && config.defaultFishVoiceId)
    voiceIdInput.value = config.defaultFishVoiceId
}

function setConnectedControls(isConnected: boolean) {
  if (!connectButton || !disconnectButton || !roomInput || !voiceIdInput || !muteButton) return
  connectButton.classList.toggle('active', isConnected)
  connectButton.disabled = isConnected
  disconnectButton.classList.toggle('active', isConnected)
  disconnectButton.disabled = !isConnected
  roomInput.disabled = isConnected
  voiceIdInput.disabled = isConnected
  muteButton.disabled = !isConnected || !localMicTrack
}

function transcriptStorageKey(roomName = currentRoomName()) {
  return `${transcriptStoragePrefix}${roomName}`
}

function currentRoomName() {
  return roomInput?.value.trim() || 'fish-voice-demo'
}

function sortedTranscriptItems(limit = maxPersistedTranscriptItems) {
  return [...transcriptItems.values()].sort((a, b) => a.receivedAt - b.receivedAt).slice(-limit)
}

function saveTranscript(roomName = currentRoomName()) {
  try {
    localStorage.setItem(transcriptStorageKey(roomName), JSON.stringify(sortedTranscriptItems()))
  } catch (error) {
    console.warn('failed to save transcript', error)
  }
}

function loadTranscript(roomName = currentRoomName()) {
  transcriptItems.clear()

  try {
    const stored = localStorage.getItem(transcriptStorageKey(roomName))
    if (!stored) return

    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return

    for (const item of parsed) {
      if (!isTranscriptItem(item)) continue
      transcriptItems.set(item.id, item)
    }
  } catch (error) {
    console.warn('failed to load transcript', error)
  }
}

function isTranscriptItem(value: unknown): value is TranscriptItem {
  if (!value || typeof value !== 'object') return false

  // TODO: type properly
  const item = value as Partial<TranscriptItem>
  return (
    typeof item.id === 'string' &&
    (item.speaker === 'you' || item.speaker === 'agent') &&
    typeof item.text === 'string' &&
    typeof item.final === 'boolean' &&
    typeof item.receivedAt === 'number'
  )
}

function setMicMuted(nextMuted: boolean) {
  micMuted = nextMuted
  const label = micMuted ? 'Unmute microphone' : 'Mute microphone'
  muteButton?.setAttribute('aria-label', label)
  muteButton?.setAttribute('title', label)
  muteButton?.setAttribute('aria-pressed', String(micMuted))
  muteButton?.classList.toggle('active', micMuted)
}

function attachRemoteTrack(track: RemoteTrack) {
  if (track.kind !== Track.Kind.Audio) return
  if (!remoteAudio) return
  track.attach(remoteAudio)
  void remoteAudio.play().catch(error => {
    console.warn('remote audio playback did not start automatically', error)
  })
}

function renderTranscript() {
  const lines = sortedTranscriptItems(30)

  transcriptLines?.replaceChildren(
    ...lines.map(line => {
      const row = document.createElement('p')
      row.className = `transcript-line ${line.final ? 'final' : 'partial'}`

      const speaker = document.createElement('span')
      speaker.className = `speaker ${line.speaker}`
      speaker.textContent = line.speaker === 'you' ? 'You' : 'Agent'

      const text = document.createElement('span')
      text.className = 'text'
      text.textContent = line.text

      row.append(speaker, text)
      return row
    })
  )
  if (transcriptLines) transcriptLines.scrollTop = transcriptLines.scrollHeight
}

function participantSpeaker(participant?: Participant): TranscriptSpeaker {
  if (!participant || participant.isLocal) return 'you'
  return 'agent'
}

function addTranscript(segments: TranscriptionSegment[], participant?: Participant) {
  const speaker = participantSpeaker(participant)

  for (const segment of segments) {
    const text = segment.text.trim()
    if (!text) continue

    transcriptItems.set(segment.id, {
      id: segment.id,
      speaker,
      text,
      final: segment.final,
      receivedAt: segment.firstReceivedTime || Date.now()
    })
  }

  renderTranscript()
  saveTranscript()
}

async function getToken(roomName: string, voiceId: string) {
  const response = await fetch(`${tokenServerUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: roomName, voiceId: voiceId || undefined })
  })

  if (!response.ok) throw new Error(`Token request failed: ${response.status}`)

  // TODO: use zod and properly type this response
  return (await response.json()) as {
    identity: string
    room: string
    voiceId: string
    token: string
    url: string
  }
}

function setStatus(message: string, state: ConnectionState | 'error') {
  if (!statusText || !statusDot) return
  statusText.textContent = message
  statusDot.dataset.state = state
}

async function connect() {
  const roomName = currentRoomName()
  const voiceId = voiceIdInput?.value.trim()
  setStatus('Checking Fish Audio', ConnectionState.Connecting)

  if (!voiceId) throw new Error('Fish Voice ID is required')
  const credentials = await getToken(roomName, voiceId)
  const nextRoom = new Room({
    adaptiveStream: true,
    dynacast: true
  })

  nextRoom
    .on(RoomEvent.ConnectionStateChanged, state => {
      setStatus(state, state)
    })
    .on(RoomEvent.ParticipantConnected, participant => {
      setStatus(`${participant.identity} joined`, ConnectionState.Connected)
    })
    .on(RoomEvent.TrackSubscribed, track => {
      attachRemoteTrack(track)
      setStatus('Receiving agent audio', ConnectionState.Connected)
    })
    .on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      addTranscript(segments, participant)
    })
    .on(RoomEvent.Disconnected, () => {
      localMicTrack = undefined
      setMicMuted(false)
      setConnectedControls(false)
      setStatus('Disconnected', ConnectionState.Disconnected)
    })

  await nextRoom.connect(credentials.url, credentials.token)

  const micTrack = await createLocalAudioTrack({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  })
  localMicTrack = micTrack
  await nextRoom.localParticipant.publishTrack(micTrack, {
    name: 'microphone'
  })
  await applyMicMute()

  room = nextRoom
  setConnectedControls(true)
  setStatus(`Connected as ${credentials.identity}`, ConnectionState.Connected)
  loadTranscript(roomName)
  renderTranscript()
}

async function disconnect() {
  saveTranscript()
  await room?.disconnect()
  room = undefined
  localMicTrack = undefined
  setConnectedControls(false)
}

async function applyMicMute() {
  if (!localMicTrack) return

  if (micMuted) await localMicTrack.mute()
  else await localMicTrack.unmute()
}

connectButton?.addEventListener('click', () => {
  connect().catch((error: unknown) => {
    console.error(error)
    const message = error instanceof Error ? error.message : 'Connection failed'
    setStatus(message, 'error')
    setConnectedControls(false)
  })
})

disconnectButton?.addEventListener('click', () => {
  disconnect().catch(error => {
    console.error(error)
    setStatus('Disconnect failed', 'error')
  })
})

muteButton?.addEventListener('click', () => {
  setMicMuted(!micMuted)
  applyMicMute().catch(error => {
    console.error(error)
    setStatus('Mic mute failed', 'error')
    setMicMuted(!micMuted)
  })
})

roomInput.addEventListener('change', () => {
  loadTranscript()
  renderTranscript()
})

loadConfig().catch(error => {
  console.warn('config load failed', error)
})

loadTranscript()
renderTranscript()
