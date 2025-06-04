const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

type Note = {
  frequency: number;
  duration: number; // For sustained notes (pads, bass, atmosphere): time until release phase starts (in beats)
                   // For short notes (melody, arp): total duration including release (in beats)
  velocity?: number;
  type?: OscillatorType;
  attack?: number; // seconds
  decay?: number;  // seconds
  sustain?: number; // level 0-1 (of velocity)
  release?: number; // seconds (duration of release phase)
  instrument?: 'pad' | 'bass' | 'lead' | 'arp' | 'atmosphere' | 'drum' | 'electricPiano' | 'flute' | 'shaker' | 'pluck'; // For easier debugging/specific handling
  // For melody/arp scheduling:
  targetBeatInBar?: number; // Which quarter beat (0-3) or 16th step (0-15) this note should play on
  arpIndex?: number; // Index in the arpeggio sequence
  /** Pre-computed 16th-step position for precise scheduling (0-15) */
  target16thStep?: number;
};

type DrumPattern = {
  kick: number[]; // 16 steps, value is velocity (0-1)
  snare: number[];
  hihat: number[];
};

// Helper to convert semitones to frequency multiplier
const semitoneToRatio = (semitones: number): number => Math.pow(2, semitones / 12);

class AudioEngine {
  private isPlaying = false;
  private mainGainNode: GainNode;
  private bpm: number = 70;
  private lookahead: number = 0.1;
  private scheduleInterval: number = 0.025;
  private nextNoteTime: number = 0;
  private currentGlobal16thStep: number = 0;
  private current16thStepInBar: number = 0;

  private lowpassFilter: BiquadFilterNode;
  private reverbNode: ConvolverNode | null = null;
  private delayNode: DelayNode;
  private feedbackNode: GainNode;
  private delayFilterNode: BiquadFilterNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  /** Send path for global reverb (parallel to delay) */
  private reverbSendGain: GainNode;

  private intervalId: number | null = null;
  private currentVolume: number = 0.35; // Adjusted default volume
  private currentSeed: number = 0;

  private scale: number[] = [];
  private keyRootFreq: number = 220;
  private progressionTemplate: number[] = [];
  private progressionIndex: number = 0;
  private currentScaleDegree: number = 0;
  private currentScaleNotes: number[] = [];

  private barCount: number = 0;

  // Current bar's musical content
  private currentChord: {
    rootFreq: number; // Frequency of the chord's root note
    intervals: number[]; // Semitone intervals from the chord root (e.g., [0, 4, 7, 11] for Maj7)
    absoluteSemitones: number[]; // Absolute semitone values of chord notes (from key root)
  } | null = null;

  private currentPadNotes: Note[] = [];
  private prevPadFrequencies: number[] = []; // For voice leading
  private currentBassNote: Note | null = null;
  private currentLeadMelodyNotes: Note[] = [];
  private currentArpNotes: Note[] = [];
  private currentAtmosphereNote: Note | null = null; // Single long drone
  private currentElectricPianoNotes: Note[] = [];
  private currentFluteNotes: Note[] = [];

  private currentDrumPattern: DrumPattern = { kick: [], snare: [], hihat: [] };
  private vinylCrackle: boolean = false;

  private static progressionTemplates = [
    [0, 5, 3, 4], // I-vi-IV-V
    [0, 3, 1, 4], // I-IV-ii-V
    [0, 5, 1, 4], // I-vi-ii-V
    [0, 1, 3, 4], // I-ii-IV-V
    [5, 1, 3, 0], // vi-ii-IV-I
    [0, 3, 0, 4], // I-IV-I-V (common pop/lofi)
    [1, 4, 0, 0], // ii-V-I-I (jazzier turnaround)
    [0, 1, 4, 5], // I-ii-V-vi
    [0, 4],       // I-V (simple repeating)
    [0, 3],       // I-IV (simple repeating)
    [0, 5, 1, 3, 0, 5, 1, 4] // Longer 8-chord progression I-vi-ii-IV-I-vi-ii-V
  ];

  private static chordVoicings = { // Semitones from chord root
    // Triads
    triadMaj: [0, 4, 7],
    triadMin: [0, 3, 7],
    // Sevenths
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    dom7: [0, 4, 7, 10],
    // Sixths
    maj6: [0, 4, 7, 9],
    min6: [0, 3, 7, 9],
    // Ninths
    maj9: [0, 4, 7, 11, 14],
    min9: [0, 3, 7, 10, 14],
    dom9: [0, 4, 7, 10, 14],
    // Added Tone & Suspended
    add9: [0, 4, 7, 14], // Major triad with added 9th
    minAdd9: [0, 3, 7, 14], // Minor triad with added 9th
    sus4: [0, 5, 7], // Suspended 4th triad
    dom7sus4: [0, 5, 7, 10],
    // More open/sparse voicings (can be good for lofi pads/EP)
    maj7no5: [0, 4, 11], // Major 7th, no 5th
    min7no5: [0, 3, 10], // Minor 7th, no 5th
  };

  constructor() {
    const storedVolume = localStorage.getItem('audioEngineVolume');
    if (storedVolume !== null) {
      const parsedVolume = parseFloat(storedVolume);
      if (!isNaN(parsedVolume) && parsedVolume >= 0 && parsedVolume <= 1) {
        this.currentVolume = parsedVolume;
      }
    }
    this.mainGainNode = audioContext.createGain();
    this.mainGainNode.gain.value = this.currentVolume;

    // Initialize all nodes first
    this.lowpassFilter = audioContext.createBiquadFilter();
    this.lowpassFilter.type = "lowpass";
    this.lowpassFilter.frequency.value = 3500;
    this.lowpassFilter.Q.value = 0.7;

    this.dryGain = audioContext.createGain();
    this.wetGain = audioContext.createGain();
    this.reverbSendGain = audioContext.createGain(); // Initialize early
    this.dryGain.gain.value = 0.65;
    this.wetGain.gain.value = 0.35;
    this.reverbSendGain.gain.value = 0.5;

    this.delayNode = audioContext.createDelay(2.0);
    this.feedbackNode = audioContext.createGain();
    this.delayFilterNode = audioContext.createBiquadFilter();
    this.delayFilterNode.type = 'lowpass';
    this.delayFilterNode.frequency.value = 1200;
    this.delayFilterNode.Q.value = 0.5;

    // Set up initial echo parameters
    this.feedbackNode.gain.value = 0.35;
    this.delayNode.delayTime.value = (60 / this.bpm) * 0.5;

    // Now connect everything
    this.mainGainNode.connect(this.lowpassFilter);
    this.lowpassFilter.connect(this.reverbSendGain);
    this.lowpassFilter.connect(this.dryGain);
    this.dryGain.connect(audioContext.destination);
    this.lowpassFilter.connect(this.delayNode);
    this.delayNode.connect(this.delayFilterNode);
    this.delayFilterNode.connect(this.feedbackNode);
    this.feedbackNode.connect(this.delayNode);

    this.createReverb().then(() => {
      if (this.reverbNode) {
        this.delayFilterNode.connect(this.reverbNode);
        this.reverbSendGain.connect(this.reverbNode);
        this.reverbNode.connect(this.wetGain);
      } else {
        this.delayFilterNode.connect(this.wetGain);
        this.reverbSendGain.connect(this.wetGain);
      }
      this.wetGain.connect(audioContext.destination);
    });

    this.currentSeed = Date.now() % 100000;
  }

  private seededRandom(seedIncrement: number = 0): () => number {
    let value = this.currentSeed + seedIncrement;
    return function() {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280.0;
    };
  }

  private async createReverb() {
    try {
      const impulseLength = audioContext.sampleRate * 3.0; // Longer reverb tail
      const impulse = audioContext.createBuffer(2, impulseLength, audioContext.sampleRate);
      const rng = Math.random; // Or use a fixed seed for consistent reverb character

      for (let channel = 0; channel < 2; channel++) {
        const impulseData = impulse.getChannelData(channel);
        for (let i = 0; i < impulseLength; i++) {
          impulseData[i] = (rng() * 2 - 1) * Math.pow(1 - i / impulseLength, 2.2); // Adjusted decay curve
        }
      }
      this.reverbNode = audioContext.createConvolver();
      this.reverbNode.buffer = impulse;
    } catch (error) {
      console.error("Failed to create reverb:", error);
      this.reverbNode = null;
    }
  }

  private scheduleNote(note: Note, time: number): void {
    const beatDuration = 60 / this.bpm;
    const vel = note.velocity || 0.3;
    let baseAttack = 0.01, baseDecay = 0.1, baseSustain = 0.7, baseRelease = 0.5;

    // Instrument-specific defaults
    switch (note.instrument) {
        case 'pad':
            baseAttack = note.attack ?? 0.8;
            baseDecay = note.decay ?? 1.5;
            baseSustain = note.sustain ?? 0.6;
            baseRelease = note.release ?? 2.0;
            break;
        case 'bass':
            baseAttack = note.attack ?? 0.02;
            baseDecay = note.decay ?? 0.2;
            baseSustain = note.sustain ?? 0.8;
            baseRelease = note.release ?? 0.3;
            break;
        case 'lead':
            baseAttack = note.attack ?? 0.05;
            baseDecay = note.decay ?? 0.3;
            baseSustain = note.sustain ?? 0.7;
            baseRelease = note.release ?? 0.8;
            break;
        case 'arp':
            baseAttack = note.attack ?? 0.01;
            baseDecay = note.decay ?? 0.1;
            baseSustain = note.sustain ?? 0.7;
            baseRelease = note.release ?? 0.2;
            break;
        case 'atmosphere':
            baseAttack = note.attack ?? 3.0;
            baseDecay = note.decay ?? 2.0;
            baseSustain = note.sustain ?? 0.5;
            baseRelease = note.release ?? 4.0;
            break;
        case 'electricPiano':
            baseAttack = note.attack ?? 0.02;
            baseDecay = note.decay ?? 0.8; // Longer decay for EP resonance
            baseSustain = note.sustain ?? 0.3;
            baseRelease = note.release ?? 0.5;
            break;
        case 'flute':
            baseAttack = note.attack ?? 0.03;
            baseDecay = note.decay ?? 0.25;
            baseSustain = note.sustain ?? 0.5;
            baseRelease = note.release ?? 0.65;
            break;
        default:
            baseAttack = note.attack ?? 0.01;
            baseDecay = note.decay ?? 0.1;
            baseSustain = note.sustain ?? 0.7;
            baseRelease = note.release ?? 0.5;
            break;
    }

    const attack = baseAttack;
    const decay = baseDecay;
    const sustain = baseSustain;
    const release = baseRelease;

    const noteSustainPhaseDuration = note.duration * beatDuration;
    const totalNoteDuration = noteSustainPhaseDuration + release;

    const createOscillatorNode = (oscType: OscillatorType, detuneValue: number = 0): OscillatorNode => {
        const osc = audioContext.createOscillator();
        osc.type = oscType;
        osc.frequency.value = note.frequency;
        if (detuneValue !== 0) osc.detune.value = detuneValue;
        return osc;
    };

    const noteGain = audioContext.createGain();
    noteGain.gain.setValueAtTime(0, time);
    noteGain.gain.linearRampToValueAtTime(vel, time + attack);
    noteGain.gain.linearRampToValueAtTime(vel * sustain, time + attack + decay);
    const sustainEndTime = time + noteSustainPhaseDuration;
    if (sustainEndTime > time + attack + decay) {
        noteGain.gain.setValueAtTime(vel * sustain, sustainEndTime);
    }
    noteGain.gain.linearRampToValueAtTime(0, sustainEndTime + release);
    noteGain.connect(this.mainGainNode);

    let oscillators: OscillatorNode[] = [];

    switch (note.instrument) {
        case 'pad':
            // Thicker pad with two slightly detuned sawtooth waves, filtered
            const padFilter = audioContext.createBiquadFilter();
            padFilter.type = 'lowpass';
            padFilter.frequency.value = 800 + (note.velocity || 0.3) * 400; // Brighter with higher velocity
            padFilter.Q.value = 0.8;
            padFilter.connect(noteGain);

            const oscPad1 = createOscillatorNode(note.type || 'sawtooth', -7);
            const oscPad2 = createOscillatorNode(note.type || 'sawtooth', 7);
            oscPad1.connect(padFilter);
            oscPad2.connect(padFilter);
            oscillators.push(oscPad1, oscPad2);
            break;

        case 'bass':
            // Solid bass with a sine and a subtle square wave an octave higher for harmonics, filtered
            const bassFilter = audioContext.createBiquadFilter();
            bassFilter.type = 'lowpass';
            bassFilter.frequency.value = 400;
            bassFilter.Q.value = 1;
            bassFilter.connect(noteGain);

            const oscBass1 = createOscillatorNode(note.type || 'sine');
            const oscBass2 = createOscillatorNode('square');
            oscBass2.frequency.value = note.frequency * 2; // Octave higher for subtle harmonic
            const bass2Gain = audioContext.createGain();
            bass2Gain.gain.value = 0.2; // Keep square wave subtle
            
            oscBass1.connect(bassFilter);
            oscBass2.connect(bass2Gain);
            bass2Gain.connect(bassFilter);
            oscillators.push(oscBass1, oscBass2);
            break;

        case 'lead':
            const leadFilter = audioContext.createBiquadFilter();
            leadFilter.type = 'lowpass';
            leadFilter.frequency.setValueAtTime(600, time);
            leadFilter.frequency.linearRampToValueAtTime(1500, time + attack + decay * 0.5);
            leadFilter.frequency.linearRampToValueAtTime(900, time + totalNoteDuration);
            leadFilter.Q.value = 1;
            leadFilter.connect(noteGain);
            const oscLead = createOscillatorNode(note.type || 'triangle');
            oscLead.connect(leadFilter);
            oscillators.push(oscLead);
            break;

        case 'arp':
            const arpFilter = audioContext.createBiquadFilter();
            arpFilter.type = 'lowpass';
            arpFilter.frequency.value = 1200 + (note.velocity || 0.3) * 500;
            arpFilter.Q.value = 0.7;
            arpFilter.connect(noteGain);
            const oscArp = createOscillatorNode(note.type || 'sine');
            oscArp.connect(arpFilter);
            oscillators.push(oscArp);
            break;

        case 'atmosphere': // Long, evolving drone
            const atmoFilter = audioContext.createBiquadFilter();
            atmoFilter.type = 'bandpass';
            atmoFilter.frequency.setValueAtTime(note.frequency * 0.8, time);
            atmoFilter.frequency.linearRampToValueAtTime(note.frequency * 1.2, time + totalNoteDuration * 0.75);
            atmoFilter.Q.value = 2;
            atmoFilter.connect(noteGain);
            const oscAtmo = createOscillatorNode(note.type || 'sine');
            oscAtmo.connect(atmoFilter);
            oscillators.push(oscAtmo);
            break;

        case 'electricPiano':
            // EP sound using two sine waves (fundamental and an overtone)
            const epFilter = audioContext.createBiquadFilter();
            epFilter.type = 'lowpass';
            epFilter.frequency.value = 1500; 
            epFilter.Q.value = 0.5;
            epFilter.connect(noteGain);

            const oscEp1 = createOscillatorNode('sine'); // Fundamental
            const oscEp2 = createOscillatorNode('sine'); // Overtone (e.g., octave + major third or similar)
            oscEp2.frequency.value = note.frequency * 2.5198; // Approx Octave + Major Third (can be tuned)
            const ep2Gain = audioContext.createGain();
            ep2Gain.gain.value = 0.4; // Overtone volume

            oscEp1.connect(epFilter);
            oscEp2.connect(ep2Gain);
            ep2Gain.connect(epFilter);
            oscillators.push(oscEp1, oscEp2);
            break;

        case 'flute':
            // Breath-y flute using sine + gentle noise through bandpass
            const fluteFilter = audioContext.createBiquadFilter();
            fluteFilter.type = 'bandpass';
            fluteFilter.frequency.value = note.frequency;
            fluteFilter.Q.value = 8;
            fluteFilter.connect(noteGain);

            const oscFlute = createOscillatorNode('sine');
            oscFlute.connect(fluteFilter);
            oscillators.push(oscFlute);

            // Subtle breath noise layer
            const noiseDur = totalNoteDuration;
            const noiseBuf = audioContext.createBuffer(1, audioContext.sampleRate * noiseDur, audioContext.sampleRate);
            const data = noiseBuf.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = (Math.random() * 2 - 1) * 0.02;
            }
            const noiseSrc = audioContext.createBufferSource();
            noiseSrc.buffer = noiseBuf;
            const noiseBP = audioContext.createBiquadFilter();
            noiseBP.type = 'bandpass';
            noiseBP.frequency.value = note.frequency * 2;
            noiseBP.Q.value = 1;
            const noiseGain = audioContext.createGain();
            noiseGain.gain.value = 0.1;
            noiseSrc.connect(noiseBP);
            noiseBP.connect(noiseGain);
            noiseGain.connect(noteGain);
            noiseSrc.start(time);
            noiseSrc.stop(time + totalNoteDuration);
            break;

        default: // Fallback for 'drum' or unspecified instruments if they reach here
            const oscDefault = createOscillatorNode(note.type || 'sine');
            oscDefault.connect(noteGain);
            oscillators.push(oscDefault);
            break;
    }

    oscillators.forEach(osc => {
        osc.start(time);
        osc.stop(time + totalNoteDuration);
    });
  }

  private scheduleDrum(type: 'kick' | 'snare' | 'hihat', time: number, velocity: number = 1): void {
    const drumGainOutputNode: AudioNode = this.mainGainNode;
    const rng = this.seededRandom(this.barCount + this.current16thStepInBar);
    
    if (type === 'kick') {
      // Hard-hitting kick with strong attack
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, time);
      osc.frequency.exponentialRampToValueAtTime(40, time + 0.4);
      
      gain.gain.setValueAtTime(1.5 * velocity, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      
      // Add click at the start
      const click = audioContext.createBufferSource();
      const clickBuffer = audioContext.createBuffer(1, 1024, audioContext.sampleRate);
      const clickData = clickBuffer.getChannelData(0);
      for (let i = 0; i < clickData.length; i++) {
        clickData[i] = (Math.random() * 2 - 1) * 0.5;
      }
      
      click.buffer = clickBuffer;
      const clickGain = audioContext.createGain();
      clickGain.gain.setValueAtTime(0.8 * velocity, time);
      clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.01);
      
      osc.connect(gain).connect(drumGainOutputNode);
      click.connect(clickGain).connect(drumGainOutputNode);
      
      osc.start(time);
      click.start(time);
      osc.stop(time + 0.4);
      
    } else if (type === 'snare') {
      // Snappy snare with noise burst
      const noiseDuration = 0.2;
      const noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate * noiseDuration, audioContext.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      
      // Generate noise with strong transient
      for (let i = 0; i < noiseData.length; i++) {
        const fade = 1 - (i / noiseData.length);
        noiseData[i] = (Math.random() * 2 - 1) * fade * 0.8;
      }
      
      const noise = audioContext.createBufferSource();
      noise.buffer = noiseBuffer;
      
      // Noise envelope - very fast attack
      const noiseGain = audioContext.createGain();
      noiseGain.gain.setValueAtTime(0, time);
      noiseGain.gain.linearRampToValueAtTime(1.2 * velocity, time + 0.002);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, time + noiseDuration);
      
      // Noise filter - sharp bandpass
      const noiseFilter = audioContext.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 1000 + rng() * 1000;
      noiseFilter.Q.value = 2.0;
      
      // Body tone
      const bodyOsc = audioContext.createOscillator();
      const bodyGain = audioContext.createGain();
      bodyOsc.type = 'triangle';
      bodyOsc.frequency.value = 180 + rng() * 60;
      bodyGain.gain.setValueAtTime(0.8 * velocity, time);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      
      noise.connect(noiseFilter).connect(noiseGain).connect(drumGainOutputNode);
      bodyOsc.connect(bodyGain).connect(drumGainOutputNode);
      
      noise.start(time);
      bodyOsc.start(time);
      noise.stop(time + noiseDuration);
      bodyOsc.stop(time + 0.1);
      
    } else if (type === 'hihat') {
      // Sharp hi-hat with strong transient
      const noiseDuration = 0.08;
      const noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate * noiseDuration, audioContext.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      
      // Generate noise with strong initial transient
      for (let i = 0; i < noiseData.length; i++) {
        noiseData[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - (i / (noiseData.length * 0.5)));
      }
      
      const noise = audioContext.createBufferSource();
      noise.buffer = noiseBuffer;
      
      // Very fast envelope
      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(1.0 * velocity, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + noiseDuration * 0.8);
      
      // Aggressive high-pass filtering
      const filter = audioContext.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 6000;
      filter.Q.value = 0.7;
      
      // Boost presence
      const presence = audioContext.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 8000;
      presence.gain.value = 12.0;
      presence.Q.value = 1.0;
      
      noise.connect(filter)
             .connect(presence)
             .connect(gain)
             .connect(drumGainOutputNode);
      
      noise.start(time);
      noise.stop(time + noiseDuration);
    }
  }

  // Determines chord type (maj7, min7, dom7) based on its function in the scale
  private getChordQualityAndVoicing(scaleDegree: number, scale: number[], rng: () => number): number[] {
    // This is a simplified diatonic chord function mapping for major-like scales
    // scaleDegree is 0-6
    // I, IV are typically Major
    // ii, iii, vi are typically minor
    // V is typically Dominant
    // vii° is diminished (not used much in lofi, often subbed or avoided)

    let quality: 'maj' | 'min' | 'dom' = 'maj';
    if ([0, 3].includes(scaleDegree)) { // I, IV
      quality = 'maj';
    } else if ([1, 2, 5].includes(scaleDegree)) { // ii, iii, vi
      quality = 'min';
    } else if (scaleDegree === 4) { // V
      quality = 'dom';
    } else { // vii° or other modal chords - default to minor for smoother lofi
      quality = 'min';
    }

    const preferSimpleVoicings = rng() < 0.3; // 30% chance to lean towards simpler voicings overall for this chord

    if (quality === 'maj') {
      if (preferSimpleVoicings) {
        const choices = [AudioEngine.chordVoicings.triadMaj, AudioEngine.chordVoicings.maj6, AudioEngine.chordVoicings.add9, AudioEngine.chordVoicings.maj7no5];
        return choices[Math.floor(rng() * choices.length)];
      }
      const choices = [AudioEngine.chordVoicings.maj7, AudioEngine.chordVoicings.maj9, AudioEngine.chordVoicings.maj6, AudioEngine.chordVoicings.add9];
      return choices[Math.floor(rng() * choices.length)];
    }
    if (quality === 'min') {
      if (preferSimpleVoicings) {
        const choices = [AudioEngine.chordVoicings.triadMin, AudioEngine.chordVoicings.min6, AudioEngine.chordVoicings.minAdd9, AudioEngine.chordVoicings.min7no5];
        return choices[Math.floor(rng() * choices.length)];
      }
      const choices = [AudioEngine.chordVoicings.min7, AudioEngine.chordVoicings.min9, AudioEngine.chordVoicings.min6, AudioEngine.chordVoicings.minAdd9];
      return choices[Math.floor(rng() * choices.length)];
    }
    if (quality === 'dom') {
      const choices = [AudioEngine.chordVoicings.dom7, AudioEngine.chordVoicings.dom9, AudioEngine.chordVoicings.dom7sus4];
      return choices[Math.floor(rng() * choices.length)];
    }
    
    return AudioEngine.chordVoicings.maj7; // Fallback if quality is somehow not caught
  }

  private getNotesInScale(rootNoteFrequency: number, scaleIntervals: number[], numOctavesToCover: number = 4): number[] {
    const notes = new Set<number>();
    const minMidiNote = 24; // C1
    const maxMidiNote = 96; // C7

    // Convert root frequency to MIDI note
    // MIDI note A4 (69) is 440 Hz.
    // formula: midi = 69 + 12 * log2(freq/440)
    const rootMidi = 69 + 12 * Math.log2(rootNoteFrequency / 440);

    // Iterate octaves around the rootMidi to ensure coverage
    for (let octaveOffset = -Math.floor(numOctavesToCover / 2); octaveOffset <= Math.ceil(numOctavesToCover / 2); octaveOffset++) {
      for (const interval of scaleIntervals) {
        const note = Math.round(rootMidi + interval + (12 * octaveOffset)); // Round to nearest MIDI note
        if (note >= minMidiNote && note <= maxMidiNote) {
          notes.add(note);
        }
      }
    }
    // Ensure the direct root octave notes are included
    for (const interval of scaleIntervals) {
        const noteInRootOctave = Math.round(rootMidi + interval);
        if (noteInRootOctave >= minMidiNote && noteInRootOctave <= maxMidiNote) {
            notes.add(noteInRootOctave);
        }
    }
    return Array.from(notes).sort((a, b) => a - b);
  }

  public generateNewPatterns(): void {
    const rngSeed = this.currentSeed;
    const baseRng = this.seededRandom(rngSeed);

    const rootNotes = [
        82.41,  // E2
        98.00,  // G2
        110.00, // A2
        130.81, // C3
        146.83, // D3
        164.81, // E3
        196.00  // G3
    ];
    this.keyRootFreq = rootNotes[Math.floor(baseRng() * rootNotes.length)];
    
    const scales = [
      { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
      { name: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
      { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
      { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
      { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
      { name: 'Pentatonic Major', intervals: [0, 2, 4, 7, 9] },
      { name: 'Pentatonic Minor', intervals: [0, 3, 5, 7, 10] }
    ];
    this.scale = scales[Math.floor(baseRng() * scales.length)].intervals;
    this.currentScaleNotes = this.getNotesInScale(this.keyRootFreq, this.scale);
    
    this.progressionTemplate = AudioEngine.progressionTemplates[Math.floor(baseRng() * AudioEngine.progressionTemplates.length)];
    this.progressionIndex = 0;

    // Seed-influenced BPM range
    const bpmCenter = 60 + Math.floor(baseRng() * 20); // 60-80 centers
    const bpmSpread = 5 + Math.floor(baseRng() * 5);   // +/- 5-10 spread
    this.bpm = Math.max(50, Math.min(90, bpmCenter - bpmSpread + Math.floor(baseRng() * (bpmSpread * 2 + 1)) ));
    
    this.lowpassFilter.frequency.value = 2000 + baseRng() * 2500; // 2kHz-4.5kHz
    
    const delayTimeOptions = [0.25, 0.5, 0.75, 1.0]; // quarter, half, dotted quarter, whole beat relative to BPM
    const delayTimeMultiplier = delayTimeOptions[Math.floor(baseRng() * delayTimeOptions.length)];
    const delayTimeValue = (60 / this.bpm) * delayTimeMultiplier;
    this.delayNode.delayTime.value = delayTimeValue;
    this.feedbackNode.gain.value = 0.25 + baseRng() * 0.3; // 0.25-0.55 feedback

    this.barCount = 0;
    this.currentGlobal16thStep = 0;
    this.current16thStepInBar = 0;
    this.prevPadFrequencies = []; // Reset voice leading history
    
    // Generate the very first bar's content.
    // The scheduler will call generateNextBar for subsequent bars.
    // We need to prime `currentChord` here.
    this.currentScaleDegree = this.progressionTemplate[this.progressionIndex];
    const semitoneInKey = this.scale[this.currentScaleDegree % this.scale.length];
    const chordRootFreq = this.keyRootFreq * semitoneToRatio(semitoneInKey);
    const voicingIntervals = this.getChordQualityAndVoicing(this.currentScaleDegree, this.scale, this.seededRandom(rngSeed + this.barCount + 8));
    this.currentChord = {
        rootFreq: chordRootFreq,
        intervals: voicingIntervals,
        absoluteSemitones: voicingIntervals.map(i => semitoneInKey + i)
    };
  }

  // Simple voice leading for pads: try to keep notes close to previous chord's notes
  private voiceLeadPads(targetChordFreqs: number[], prevChordFreqs: number[]): number[] {
    if (prevChordFreqs.length === 0 || targetChordFreqs.length === 0) return targetChordFreqs;

    const ledFreqs: number[] = [];
    const availableTargetFreqs = [...targetChordFreqs]; // Modifiable copy

    for (const prevFreq of prevChordFreqs) {
        if (availableTargetFreqs.length === 0) break;
        let closestTargetFreq = availableTargetFreqs[0];
        let minDiff = Math.abs(Math.log2(prevFreq / closestTargetFreq) * 12); // Difference in semitones
        let closestIndex = 0;

        for (let i = 1; i < availableTargetFreqs.length; i++) {
            const diff = Math.abs(Math.log2(prevFreq / availableTargetFreqs[i]) * 12);
            if (diff < minDiff) {
                minDiff = diff;
                closestTargetFreq = availableTargetFreqs[i];
                closestIndex = i;
            }
        }
        ledFreqs.push(closestTargetFreq);
        availableTargetFreqs.splice(closestIndex, 1); // Remove used note
    }
    // Add any remaining target freqs that weren't matched
    ledFreqs.push(...availableTargetFreqs);
    return ledFreqs.sort((a, b) => a - b); // Keep them sorted for consistency
}

  private generateNextBar(rng: () => number) {
    // --- Chord Progression ---
    if (this.barCount > 0) { // Don't advance progression for the very first bar (already set in generateNewPatterns)
        this.progressionIndex = (this.progressionIndex + 1) % this.progressionTemplate.length;
    }
    this.currentScaleDegree = this.progressionTemplate[this.progressionIndex];
    const semitoneInKeyForChordRoot = this.scale[this.currentScaleDegree % this.scale.length];
    const chordRootFreq = this.keyRootFreq * semitoneToRatio(semitoneInKeyForChordRoot);
    const chordVoicingIntervals = this.getChordQualityAndVoicing(this.currentScaleDegree, this.scale, rng);
    
    this.currentChord = {
        rootFreq: chordRootFreq,
        intervals: chordVoicingIntervals,
        absoluteSemitones: chordVoicingIntervals.map(i => semitoneInKeyForChordRoot + i)
    };

    // --- Define currentChordMidiNotes ---
    // This should be placed after this.currentChord is set:
    const currentChordAbsoluteFrequencies = this.currentChord.absoluteSemitones.map(semi =>
        this.keyRootFreq * semitoneToRatio(semi)
    );
    const currentChordMidiNotes = currentChordAbsoluteFrequencies.map(freq =>
        Math.round(69 + 12 * Math.log2(freq / 440))
    ).filter(noteMidi =>
        this.currentScaleNotes.includes(noteMidi) // Ensure it's in the overall scale
    );
    // Now currentChordMidiNotes contains actual MIDI note numbers that are part of the current chord AND current scale.
    const chordRootMidi = Math.round(69 + 12 * Math.log2(this.currentChord!.rootFreq / 440));

    const baseOctavePad = rng() < 0.5 ? -1 : 0; // -1 for one octave down, 0 for root octave of key
    // const baseOctaveLead = 1; // Lead one octave above key root - This variable is not used anymore.
    // const baseOctaveArp = rng() < 0.5 ? 0 : 1; // This variable is not used anymore.

    // --- Pad ---
    let padTargetFrequencies = this.currentChord.intervals.map(interval =>
      this.currentChord!.rootFreq * semitoneToRatio(interval + (baseOctavePad * 12))
    );
    // Apply voice leading
    const ledPadFrequencies = this.voiceLeadPads(padTargetFrequencies, this.prevPadFrequencies);
    this.currentPadNotes = ledPadFrequencies.map((freq, index) => ({
        frequency: freq,
        duration: 3.8, // Held for nearly the whole bar
        velocity: 0.1 + rng() * 0.05, // Softer
        type: 'triangle',
        attack: 1.5 + rng() * 1.0, // Slow attack
        decay: 0.8, sustain: 0.7, release: 2.0 + rng() * 1.0, // Long release
        instrument: 'pad',
    }));
    this.prevPadFrequencies = [...ledPadFrequencies];

    // --- Bass ---
    let bassTargetFreq;
    const playFifthChance = 0.2; // 20% chance to play the fifth

    if (rng() < playFifthChance && this.currentChord) {
        // Try to play the fifth. Find the fifth interval in the current chord's voicing.
        let fifthInterval = this.currentChord.intervals.find(i => i === 7); // Perfect fifth is 7 semitones

        if (fifthInterval !== undefined) {
            bassTargetFreq = this.currentChord.rootFreq * semitoneToRatio(fifthInterval);
        } else {
            // If no explicit fifth in voicing, default to root for this instance.
            bassTargetFreq = this.currentChord.rootFreq;
        }
    } else if (this.currentChord) {
        // Play the root
        bassTargetFreq = this.currentChord.rootFreq;
    } else {
        // Fallback if currentChord is somehow null (should not happen in normal flow)
        bassTargetFreq = this.keyRootFreq * 0.5; // Default to a low key root
    }

    // Apply octave adjustment for bass register
    const octaveMultiplier = rng() < 0.7 ? 0.5 : 0.25; // 1 or 2 octaves down
    const finalBassFreq = bassTargetFreq * octaveMultiplier;

    this.currentBassNote = {
      frequency: finalBassFreq,
      duration: rng() < 0.3 ? 1.9 : 3.9,
      velocity: 0.20 + rng() * 0.08,
      type: rng() < 0.6 ? 'sine' : 'triangle',
      attack: 0.04, decay: 0.3, sustain: 0.8, release: 0.5 + rng() * 0.3,
      instrument: 'bass',
    };

    // --- Lead Melody (uses currentScaleNotes) ---
    this.currentLeadMelodyNotes = [];
    const numMelodyNotes = 1 + Math.floor(rng() * 3); // 1-3 notes
    const leadNoteRangeMidi = this.currentScaleNotes.filter(noteMidi => noteMidi >= 60 && noteMidi <= 84); // C4 to C6
    let pickedLeadNotesMidiThisBar: number[] = [];

    if (leadNoteRangeMidi.length > 0) {
        const availableChordTonesForLead = currentChordMidiNotes.filter(m => leadNoteRangeMidi.includes(m));
        const sortedAvailableChordTones = [...availableChordTonesForLead].sort((a,b)=>a-b);
        const harmoniousScaleNotesForLeadBase = leadNoteRangeMidi.filter(scaleNoteMidi => {
            const intervalFromRoot = Math.abs(scaleNoteMidi - chordRootMidi) % 12;
            return intervalFromRoot !== 6 && intervalFromRoot !== 1;
        });
        const sortedHarmoniousScaleNotes = [...harmoniousScaleNotesForLeadBase].sort((a,b)=>a-b);

        for (let i = 0; i < numMelodyNotes; i++) {
            let noteMidi;
            const unpickedChordTones = sortedAvailableChordTones.filter(ct => !pickedLeadNotesMidiThisBar.includes(ct));
            const unpickedHarmoniousScaleNotes = sortedHarmoniousScaleNotes.filter(sn => !pickedLeadNotesMidiThisBar.includes(sn));

            if (unpickedChordTones.length > 0 && (rng() < (i === 0 ? 0.75 : 0.60))) { // Higher chance for chord tone
                noteMidi = unpickedChordTones[0];
            } else if (unpickedHarmoniousScaleNotes.length > 0) {
                noteMidi = unpickedHarmoniousScaleNotes[0];
            } else if (unpickedChordTones.length > 0) {
                noteMidi = unpickedChordTones[0];
            } else if (leadNoteRangeMidi.length > 0) {
                const fallbackOptions = leadNoteRangeMidi.filter(n => !pickedLeadNotesMidiThisBar.includes(n));
                noteMidi = fallbackOptions.length > 0 ? fallbackOptions[0] : leadNoteRangeMidi[0];
            } else {
                continue;
            }

            if (noteMidi !== undefined) {
                pickedLeadNotesMidiThisBar.push(noteMidi);
                const noteFreq = 440 * Math.pow(2, (noteMidi - 69) / 12);
                this.currentLeadMelodyNotes.push({
                    frequency: noteFreq,
                    duration: (rng() < 0.4 ? 1.3 : 0.6) + rng() * 0.4,
                    velocity: 0.12 + rng() * 0.06,
                    type: rng() < 0.5 ? 'sine' : 'triangle',
                    attack: 0.05 + rng()*0.1, decay: 0.15, sustain: 0.6, release: 0.4 + rng()*0.3,
                    instrument: 'lead',
                    targetBeatInBar: Math.floor(rng() * 4)
                });
            }
        }
        const uniqueBeats = new Set<number>();
        this.currentLeadMelodyNotes = this.currentLeadMelodyNotes.filter(note => {
            if (note.targetBeatInBar === undefined) return false;
            if (uniqueBeats.has(note.targetBeatInBar)) return false;
            uniqueBeats.add(note.targetBeatInBar);
            return true;
        });
    }

    // --- Arpeggiator ---
    this.currentArpNotes = [];
    const arpPatternTypes = ['asc', 'desc', 'upDown', 'downUp', 'randomChordToneOrder'];
    const selectedArpPattern = arpPatternTypes[Math.floor(rng() * arpPatternTypes.length)];

    const arpBaseOctaveMidi = rng() < 0.5 ? 0 : 1;
    const arpCandidateMidiNotes = this.currentChord.absoluteSemitones.map(semi => {
        const baseFreq = this.keyRootFreq * semitoneToRatio(semi);
        let midiNote = Math.round(69 + 12 * Math.log2(baseFreq / 440));
        midiNote += (arpBaseOctaveMidi * 12);
        while (midiNote < 48 && midiNote + 12 <= 84) midiNote += 12;
        while (midiNote > 84 && midiNote - 12 >= 48) midiNote -= 12;
        return midiNote;
    }).filter(noteMidi => noteMidi >= 48 && noteMidi <= 84 && this.currentScaleNotes.includes(noteMidi));

    if (arpCandidateMidiNotes.length > 0) {
        const arpPatternLength = rng() < 0.3 ? 4 : (rng() < 0.7 ? 8 : 16);
        const uniqueArpNotes = Array.from(new Set(arpCandidateMidiNotes)).sort((a,b) => a-b);
        let finalArpNotesSequence: number[] = [];

        switch (selectedArpPattern) {
            case 'asc':
                finalArpNotesSequence = [...uniqueArpNotes];
                break;
            case 'desc':
                finalArpNotesSequence = [...uniqueArpNotes].sort((a,b) => b-a);
                break;
            case 'upDown':
                finalArpNotesSequence = [...uniqueArpNotes];
                if (uniqueArpNotes.length > 2) {
                    for (let k = uniqueArpNotes.length - 2; k > 0; k--) {
                        finalArpNotesSequence.push(uniqueArpNotes[k]);
                    }
                }
                break;
            case 'downUp':
                const descendingNotes = [...uniqueArpNotes].sort((a,b) => b-a);
                finalArpNotesSequence = [...descendingNotes];
                if (descendingNotes.length > 2) {
                    for (let k = descendingNotes.length - 2; k > 0; k--) {
                        finalArpNotesSequence.push(descendingNotes[k]);
                    }
                }
                break;
            case 'randomChordToneOrder':
                finalArpNotesSequence = [...uniqueArpNotes].sort(() => 0.5 - rng());
                break;
            default:
                finalArpNotesSequence = [...uniqueArpNotes];
        }

        if (finalArpNotesSequence.length > 0) {
            for (let i = 0; i < arpPatternLength; i++) {
                const noteMidi = finalArpNotesSequence[i % finalArpNotesSequence.length];
                const freq = 440 * Math.pow(2, (noteMidi - 69) / 12);

                this.currentArpNotes.push({
                    frequency: freq,
                    duration: 4 / arpPatternLength,
                    velocity: 0.08 + rng() * 0.04,
                    type: 'sine',
                    attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.15,
                    instrument: 'arp',
                    target16thStep: Math.floor(i * (16 / arpPatternLength))
                });
            }
        }
    }

    // --- Electric Piano ---
    this.currentElectricPianoNotes = [];
    if (this.currentChord && this.currentChord.intervals.length > 0) {
        const epBeats: number[] = [];
        // Decide which quarter beats (0-3) will receive chord stabs
        for (let beat = 0; beat < 4; beat++) {
            const threshold = beat === 0 ? 0.9 : 0.4; // Strong down-beat, some probability on others
            if (rng() < threshold) epBeats.push(beat);
        }

        epBeats.forEach(beat => {
            // Select notes for EP from currentScaleNotes, trying to match chord tones
            const epOctaveShift = -1; // EP sits an octave below pad root
            const targetChordRootMidi = 69 + 12 * Math.log2(this.currentChord!.rootFreq / 440) + (epOctaveShift * 12);

            // Get MIDI notes of the current chord in the target EP octave
            const chordToneMidiNotesInTargetOctave = this.currentChord!.intervals.map(interval => 
                Math.round(targetChordRootMidi + interval)
            );

            // Filter these chord tones to only include those present in the current scale
            // This is effectively currentChordMidiNotes filtered for the EP's octave and range.
            let notesToPlayForEP = chordToneMidiNotesInTargetOctave.filter(midiNote =>
                this.currentScaleNotes.includes(midiNote) && midiNote >= 48 && midiNote <= 72 // C3-C5 range
            );

            if (notesToPlayForEP.length === 0) {
                // Fallback: if no chord tones in scale/range, pick a few suitable harmonious scale notes
                const baseFallbackRange = this.currentScaleNotes.filter(noteMidi => noteMidi >= 48 && noteMidi <= 72); // C3-C5

                const harmoniousFallbackForEP = baseFallbackRange.filter(scaleNoteMidi => {
                    const intervalFromRoot = Math.abs(scaleNoteMidi - chordRootMidi) % 12;
                    // For EP comping, being a bit more careful with dissonances against root might be good.
                    // Explicitly avoiding tritones (6) and minor seconds (1). Major 7ths (11) might also be too spicy for generic fallback.
                    return ![1, 6, 11].includes(intervalFromRoot);
                });

                if (harmoniousFallbackForEP.length > 0) {
                    notesToPlayForEP = harmoniousFallbackForEP.sort(() => 0.5 - rng()).slice(0, 2 + Math.floor(rng() * 2));
                } else if (baseFallbackRange.length > 0) { // If harmony filter too strict, use original fallback
                     notesToPlayForEP = baseFallbackRange.sort(() => 0.5 - rng()).slice(0, 2 + Math.floor(rng() * 2));
                }
                // If baseFallbackRange is also empty, notesToPlayForEP remains empty.
            }
            
            // Take a subset if too many notes
            if (notesToPlayForEP.length > (rng() < 0.6 ? 3 : 4)) {
                notesToPlayForEP = notesToPlayForEP.sort(() => 0.5 - rng()).slice(0, rng() < 0.6 ? 3 : 4);
            }

            notesToPlayForEP.forEach(noteMidi => {
                const freq = 440 * Math.pow(2, (noteMidi - 69) / 12);
                this.currentElectricPianoNotes.push({
                    frequency: freq,
                    duration: 0.7 + rng() * 0.3, // Short, slightly varied length
                    velocity: 0.11 + rng() * 0.05,
                    type: 'sine',
                    attack: 0.02,
                    decay: 0.6,
                    sustain: 0.3,
                    release: 0.5,
                    instrument: 'electricPiano',
                    targetBeatInBar: beat
                });
            });
        });
    }

    // --- Flute ---
    this.currentFluteNotes = [];
    if (rng() < 0.8) {
        const fluteNoteCount = 1 + Math.floor(rng() * 3);
        const fluteNoteRangeMidi = this.currentScaleNotes.filter(n => n >= 60 && n <= 84); // C4 to C6
        let pickedFluteNotesMidiThisBar: number[] = [];

        if (fluteNoteRangeMidi.length > 0) {
            const availableChordTonesForFlute = currentChordMidiNotes.filter(m => fluteNoteRangeMidi.includes(m));
            const sortedAvailableChordTonesFlute = [...availableChordTonesForFlute].sort((a,b)=>a-b);
            const harmoniousScaleNotesForFluteBase = fluteNoteRangeMidi.filter(scaleNoteMidi => {
                const intervalFromRoot = Math.abs(scaleNoteMidi - chordRootMidi) % 12;
                return intervalFromRoot !== 6 && intervalFromRoot !== 1;
            });
            const sortedHarmoniousScaleNotesFlute = [...harmoniousScaleNotesForFluteBase].sort((a,b)=>a-b);

            for (let i = 0; i < fluteNoteCount; i++) {
                let noteMidi;
                const unpickedChordTones = sortedAvailableChordTonesFlute.filter(ct => !pickedFluteNotesMidiThisBar.includes(ct));
                const unpickedHarmoniousScaleNotes = sortedHarmoniousScaleNotesFlute.filter(sn => !pickedFluteNotesMidiThisBar.includes(sn));

                if (unpickedChordTones.length > 0 && (rng() < (i === 0 ? 0.70 : 0.50))) { // Higher chance for chord tone
                    noteMidi = unpickedChordTones[0];
                } else if (unpickedHarmoniousScaleNotes.length > 0) {
                    noteMidi = unpickedHarmoniousScaleNotes[0];
                } else if (unpickedChordTones.length > 0) {
                    noteMidi = unpickedChordTones[0];
                } else if (fluteNoteRangeMidi.length > 0) {
                     const fallbackOptions = fluteNoteRangeMidi.filter(n => !pickedFluteNotesMidiThisBar.includes(n));
                     noteMidi = fallbackOptions.length > 0 ? fallbackOptions[0] : fluteNoteRangeMidi[0];
                } else {
                    continue;
                }

                if (noteMidi !== undefined) {
                    pickedFluteNotesMidiThisBar.push(noteMidi);
                    const freq = 440 * Math.pow(2, (noteMidi - 69) / 12);
                    this.currentFluteNotes.push({
                        frequency: freq,
                        duration: 0.6 + rng() * 0.4,
                        velocity: 0.09 + rng() * 0.05,
                        type: 'sine',
                        instrument: 'flute',
                        targetBeatInBar: Math.floor(rng() * 4)
                    });
                }
            }
            const uniqueBeats = new Set<number>();
            this.currentFluteNotes = this.currentFluteNotes.filter(note => {
                if (note.targetBeatInBar === undefined) return true; // Keep if undefined, or handle as error
                if (uniqueBeats.has(note.targetBeatInBar)) return false;
                uniqueBeats.add(note.targetBeatInBar);
                return true;
            });
        }
    }

    // --- Atmosphere/Drone (uses currentScaleNotes) ---
    if (this.barCount % (2 + Math.floor(rng()*3)) === 0 || !this.currentAtmosphereNote) { // Change drone every 2-4 bars
        // Define desired drone MIDI range
        const droneMinMidi = 24; // C1
        const droneMaxMidi = 48; // C3

        // Get current chord's root, third, and fifth MIDI notes
        const chordRootActualMidi = Math.round(69 + 12 * Math.log2(this.currentChord!.rootFreq / 440));

        // Find the third and fifth intervals from the chord's voicing definition
        let chordThirdInterval = this.currentChord!.intervals.find(i => i === 3 || i === 4);
        let chordFifthInterval = this.currentChord!.intervals.find(i => i === 7);

        let potentialDroneMidiNotes: number[] = [];

        // Priority 1: Chord Root
        let droneRootMidi = chordRootActualMidi;
        while (droneRootMidi > droneMaxMidi && droneRootMidi - 12 >= droneMinMidi) droneRootMidi -= 12;
        while (droneRootMidi < droneMinMidi && droneRootMidi + 12 <= droneMaxMidi) droneRootMidi += 12;
        if (droneRootMidi >= droneMinMidi && droneRootMidi <= droneMaxMidi && this.currentScaleNotes.includes(droneRootMidi)) {
            potentialDroneMidiNotes.push(droneRootMidi);
        }

        // Priority 2: Chord Fifth (if defined in voicing)
        if (chordFifthInterval !== undefined) {
            let droneFifthMidi = chordRootActualMidi + chordFifthInterval;
            while (droneFifthMidi > droneMaxMidi && droneFifthMidi - 12 >= droneMinMidi) droneFifthMidi -= 12;
            while (droneFifthMidi < droneMinMidi && droneFifthMidi + 12 <= droneMaxMidi) droneFifthMidi += 12;
            if (droneFifthMidi >= droneMinMidi && droneFifthMidi <= droneMaxMidi && this.currentScaleNotes.includes(droneFifthMidi) && !potentialDroneMidiNotes.includes(droneFifthMidi)) {
                potentialDroneMidiNotes.push(droneFifthMidi);
            }
        }

        // Priority 3: Chord Third (if defined in voicing)
        if (chordThirdInterval !== undefined) {
            let droneThirdMidi = chordRootActualMidi + chordThirdInterval;
            while (droneThirdMidi > droneMaxMidi && droneThirdMidi - 12 >= droneMinMidi) droneThirdMidi -= 12;
            while (droneThirdMidi < droneMinMidi && droneThirdMidi + 12 <= droneMaxMidi) droneThirdMidi += 12;
            if (droneThirdMidi >= droneMinMidi && droneThirdMidi <= droneMaxMidi && this.currentScaleNotes.includes(droneThirdMidi) && !potentialDroneMidiNotes.includes(droneThirdMidi)) {
                potentialDroneMidiNotes.push(droneThirdMidi);
            }
        }

        // Priority 4: Key Root
        const keyRootMidi = Math.round(69 + 12 * Math.log2(this.keyRootFreq / 440));
        let droneKeyRootMidi = keyRootMidi;
        while (droneKeyRootMidi > droneMaxMidi && droneKeyRootMidi - 12 >= droneMinMidi) droneKeyRootMidi -= 12;
        while (droneKeyRootMidi < droneMinMidi && droneKeyRootMidi + 12 <= droneMaxMidi) droneKeyRootMidi += 12;
        if (droneKeyRootMidi >= droneMinMidi && droneKeyRootMidi <= droneMaxMidi && this.currentScaleNotes.includes(droneKeyRootMidi) && !potentialDroneMidiNotes.includes(droneKeyRootMidi)) {
            potentialDroneMidiNotes.push(droneKeyRootMidi);
        }

        let selectedDroneMidi: number | null = null;

        if (potentialDroneMidiNotes.length > 0) {
            selectedDroneMidi = potentialDroneMidiNotes[0];
        } else {
            // Priority 5 (Fallback): Original logic - random from available low scale notes
            const availableDroneNotes = this.currentScaleNotes.filter(noteMidi => noteMidi >= droneMinMidi && noteMidi <= droneMaxMidi);
            if (availableDroneNotes.length > 0) {
                selectedDroneMidi = availableDroneNotes[Math.floor(rng() * availableDroneNotes.length)];
            }
        }

        if (selectedDroneMidi !== null) {
            const droneFreq = 440 * Math.pow(2, (selectedDroneMidi - 69) / 12);
            this.currentAtmosphereNote = {
                frequency: droneFreq,
                duration: (3.5 + rng() * 4) * 4,
                velocity: 0.03 + rng() * 0.02,
                type: 'triangle',
                attack: 5.0 + rng() * 3.0,
                decay: 2.0, sustain: 0.8, release: 6.0 + rng() * 4.0,
                instrument: 'atmosphere',
            };
        } else {
            this.currentAtmosphereNote = null; // No suitable drone note found
        }
    }

    // --- Drums (16-step pattern) ---
    // (Drum pattern generation logic remains largely the same)
    this.currentDrumPattern = { kick: new Array(16).fill(0), snare: new Array(16).fill(0), hihat: new Array(16).fill(0) };
    this.currentDrumPattern.kick[0] = 0.9;
    if (rng() < 0.7) this.currentDrumPattern.kick[8] = 0.8; // Beat 3
    if (rng() < 0.2) this.currentDrumPattern.kick[4 + Math.floor(rng()*2)*4] = 0.7; // Beat 2 or 4
    if (rng() < 0.35) this.currentDrumPattern.kick[ [2,3,6,7,10,11,13,14][Math.floor(rng()*8)] ] = 0.6; // Syncopated

    this.currentDrumPattern.snare[4] = 0.9;
    this.currentDrumPattern.snare[12] = 0.9;
    if (rng() < 0.15) this.currentDrumPattern.snare[ [7,15][Math.floor(rng()*2)] ] = 0.5; // Ghost

    for (let i = 0; i < 16; i += 2) { // 8th notes default
        if (rng() < 0.9) this.currentDrumPattern.hihat[i] = (i % 4 === 0) ? 0.8 : 0.6;
    }
    if (rng() < 0.5) { // Chance for some 16ths
        for (let i = 0; i < 3; i++) { // Add up to 3 16th notes
            if (rng() < 0.4) this.currentDrumPattern.hihat[Math.floor(rng()*16)] = 0.5;
        }
    }

    this.vinylCrackle = rng() < 0.5;
    this.barCount++;
  }

  private scheduler() {
    while (this.nextNoteTime < audioContext.currentTime + this.lookahead && this.isPlaying) {
      this.scheduleNextNotes(this.current16thStepInBar);
      this.advanceNote();
    }
  }

  private scheduleNextNotes(current16th: number) {
    const time = this.nextNoteTime;
    const rng = this.seededRandom(this.barCount + current16th); // RNG for this specific 16th step

    if (current16th === 0) {
      this.generateNextBar(rng); // Generate content for the new bar

      // Schedule Pads (play once at bar start)
      this.currentPadNotes.forEach(note => this.scheduleNote(note, time));
      // Schedule Bass (play once at bar start, or as per its duration logic)
      if (this.currentBassNote) this.scheduleNote(this.currentBassNote, time);
      // Schedule Atmosphere Drone (plays very long, scheduled when generated)
      if (this.currentAtmosphereNote && this.barCount % (2 + Math.floor(rng()*3)) === 1 ) { // Reschedule if it was newly generated
          this.scheduleNote(this.currentAtmosphereNote, time);
      }
    }

    // Schedule Lead Melody Notes (on their target quarter beat, which is 16th step / 4)
    this.currentLeadMelodyNotes.forEach(note => {
        if (note.targetBeatInBar! * 4 === current16th) { // targetBeatInBar is 0-3 for quarter notes
            this.scheduleNote(note, time);
        }
    });
    
    // Schedule Arp Notes
    this.currentArpNotes.forEach(note => {
        if (note.target16thStep === current16th) {
            this.scheduleNote(note, time);
        }
    });

    // Schedule Electric Piano notes
    this.currentElectricPianoNotes.forEach(note => {
      // Assuming targetBeatInBar is 0-3 for quarter notes, convert to 16th steps (0, 4, 8, 12)
      const target16thStep = (note.targetBeatInBar ?? 0) * 4;
      if (target16thStep === current16th) {
        this.scheduleNote(note, time);
      }
    });

    // Schedule Flute notes
    this.currentFluteNotes.forEach(note => {
        if (note.targetBeatInBar! * 4 === current16th) {
            this.scheduleNote(note, time);
        }
    });

    // Drums
    let drumTime = time;
    const sixteenthDuration = (60.0 / this.bpm) / 4.0;
    if ([2, 6, 10, 14].includes(current16th) && this.currentDrumPattern.hihat[current16th] > 0 && rng() < 0.6) { // Swing hi-hats
      drumTime += sixteenthDuration * (0.25 + rng() * 0.3); // Swing amount
    }

    const kickVel = this.currentDrumPattern.kick[current16th];
    if (kickVel > 0) this.scheduleDrum('kick', time, kickVel);
    const snareVel = this.currentDrumPattern.snare[current16th];
    if (snareVel > 0) this.scheduleDrum('snare', time, snareVel);
    const hihatVel = this.currentDrumPattern.hihat[current16th];
    if (hihatVel > 0) this.scheduleDrum('hihat', drumTime, hihatVel);

    // Vinyl Crackle (less frequent, direct to output)
    if (this.vinylCrackle && current16th === 0 && rng() < 0.1) {
      const bufferSize = audioContext.sampleRate * (0.2 + rng() * 0.3);
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (rng() * 2 - 1) * 0.025 * Math.exp(-i/(bufferSize*0.2));
      const noise = audioContext.createBufferSource();
      noise.buffer = buffer;
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.015 + rng() * 0.02;
      noise.connect(gainNode);
      gainNode.connect(audioContext.destination); // Direct to output
      noise.start(time + rng() * sixteenthDuration * 2);
      noise.stop(time + rng() * sixteenthDuration * 2 + bufferSize/audioContext.sampleRate);
    }
  }

  private advanceNote() {
    const secondsPer16thNote = (60.0 / this.bpm) / 4.0;
    this.nextNoteTime += secondsPer16thNote;
    this.currentGlobal16thStep++;
    this.current16thStepInBar = (this.current16thStepInBar + 1) % 16;
  }

  public setSeed(seed: number): void {
    this.currentSeed = seed;
    // Force full regeneration
    if (this.isPlaying) {
        this.stop();
        // A small delay might be good if there are async operations in stop/start
        setTimeout(() => this.start(), 50);
    } else {
        // If not playing, just prime the patterns for the next start
        this.generateNewPatterns();
    }
  }

  public getSeed(): number { return this.currentSeed; }

  public async start(): Promise<void> {
    if (this.isPlaying) return;
    if (audioContext.state === 'suspended') await audioContext.resume();

    // Restore gain levels that might have been zeroed by stop()
    this.mainGainNode.gain.cancelScheduledValues(audioContext.currentTime);
    this.mainGainNode.gain.value = this.currentVolume;
    this.dryGain.gain.cancelScheduledValues(audioContext.currentTime);
    this.dryGain.gain.value = 0.65; // Default dry mix
    this.wetGain.gain.cancelScheduledValues(audioContext.currentTime);
    this.wetGain.gain.value = 0.35; // Default wet mix

    this.isPlaying = true;
    this.currentGlobal16thStep = 0; // Reset global step count
    this.current16thStepInBar = 0; // Ensure we start at bar beginning
    this.nextNoteTime = audioContext.currentTime + 0.1; // Schedule slightly ahead

    this.generateNewPatterns(); // Generate initial patterns using the current seed

    this.intervalId = window.setInterval(() => this.scheduler(), this.scheduleInterval * 1000);
  }

  public stop(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Immediately silence all audio output paths
    this.mainGainNode.gain.cancelScheduledValues(audioContext.currentTime);
    this.mainGainNode.gain.value = 0;
    this.dryGain.gain.cancelScheduledValues(audioContext.currentTime);
    this.dryGain.gain.value = 0;
    this.wetGain.gain.cancelScheduledValues(audioContext.currentTime);
    this.wetGain.gain.value = 0;
  }

  public setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (this.isPlaying) { // Only directly set gain if playing, start() will handle it otherwise
        this.mainGainNode.gain.cancelScheduledValues(audioContext.currentTime);
        this.mainGainNode.gain.setValueAtTime(this.currentVolume, audioContext.currentTime);
    }
    localStorage.setItem('audioEngineVolume', this.currentVolume.toString());
  }
  public getVolume(): number { return this.currentVolume; }

  public setBPM(bpm: number): void {
    this.bpm = Math.max(50, Math.min(100, bpm)); // Lofi BPM range
    if (this.isPlaying) { // Update delay times if BPM changes live
        const rng = this.seededRandom(this.currentSeed + this.barCount + 1001);
        const delayTimeValue = (60 / this.bpm) * (rng() < 0.6 ? 0.5 : 0.75);
        this.delayNode.delayTime.linearRampToValueAtTime(delayTimeValue, audioContext.currentTime + 0.1);
    }
  }

  public toggleFilter(active: boolean): void { // "active" usually means more muffled for lofi
    const targetFreq = active ? (1000 + this.seededRandom(this.barCount+2001)() * 800) // 1kHz-1.8kHz
                              : (3000 + this.seededRandom(this.barCount+2002)() * 2000); // 3kHz-5kHz
    this.lowpassFilter.frequency.linearRampToValueAtTime(targetFreq, audioContext.currentTime + 0.2);
  }
  public getIsPlaying(): boolean { return this.isPlaying; }
  public cleanup(): void { this.stop(); }
}

const audioEngine = new AudioEngine();
export default audioEngine;