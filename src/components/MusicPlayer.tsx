
import React, { useState, useEffect } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import audioEngine from '@/utils/audioEngine';
import { CoffeeAscii, SteamAscii, CatAscii } from './AsciiArt';

const MusicPlayer: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.4);
  const [muted, setMuted] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [lastStartTime, setLastStartTime] = useState(0);
  
  useEffect(() => {
    if (isPlaying) {
      const timer = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
      
      return () => {
        clearInterval(timer);
      };
    }
  }, [isPlaying]);
  
  useEffect(() => {
    if (muted) {
      audioEngine.setVolume(0);
    } else {
      audioEngine.setVolume(volume);
    }
  }, [volume, muted]);
  
  const togglePlayback = async () => {
    if (isPlaying) {
      audioEngine.stop();
      setIsPlaying(false);
    } else {
      try {
        await audioEngine.start();
        setIsPlaying(true);
        
        // If we're starting fresh, reset elapsed time
        if (lastStartTime === 0) {
          setElapsedTime(0);
        }
        
        setLastStartTime(Date.now());
      } catch (error) {
        console.error("Failed to start audio:", error);
      }
    }
  };
  
  const handleVolumeChange = (values: number[]) => {
    const newVolume = values[0];
    setVolume(newVolume);
    
    if (muted && newVolume > 0) {
      setMuted(false);
    }
  };
  
  const toggleMute = () => {
    setMuted(!muted);
  };
  
  // Format time as mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };
  
  return (
    <div className="relative w-full max-w-md px-6 py-10 bg-mantle shadow-lg rounded-lg border border-surface0 flex flex-col items-center animate-fade-in">
      {/* ASCII Coffee */}
      <div className="relative mb-6">
        <CoffeeAscii className="text-lg" />
        <SteamAscii className="top-0 left-[45%] animate-steam z-10" />
        <SteamAscii className="top-[-5px] left-[52%] animate-steam-alt z-10" animationDelay="1s" />
      </div>
      
      <h1 className="text-2xl font-bold text-pink mb-1">P̶i̶e̶d̶P̶i̶p̶e̶r̶</h1>
      <p className="text-subtext0 mb-8">infinite lo-fi music in the background</p>
      
      {/* Cat appears sometimes when music is playing */}
      {isPlaying && Math.random() > 0.7 && (
        <div className="absolute right-4 bottom-24 animate-pulse-slow opacity-70">
          <CatAscii />
        </div>
      )}
      
      {/* Controls */}
      <div className="w-full flex flex-col items-center space-y-6">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={togglePlayback}
          className="w-32 bg-surface0 hover:bg-surface1 border-surface2"
        >
          {isPlaying ? (
            <><Pause size={18} className="mr-2" /> pause</>
          ) : (
            <><Play size={18} className="mr-2" /> play</>
          )}
        </Button>
        
        <div className="w-full flex items-center space-x-4">
          <button
            onClick={toggleMute}
            className="text-overlay1 hover:text-text transition-colors"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          
          <div className="w-full">
            <Slider
              defaultValue={[volume]}
              min={0}
              max={1}
              step={0.01}
              value={[muted ? 0 : volume]}
              onValueChange={handleVolumeChange}
              className="w-full"
            />
          </div>
        </div>
      </div>
      
      {/* Elapsed time */}
      <div className="mt-8 text-sm text-subtext0">
        {formatTime(elapsedTime)}
      </div>
      
      {/* Progress bar */}
      <div className="absolute top-3 right-3 flex items-center text-xs">
        <div className="text-subtext0 mr-2">100%</div>
        <div className="w-16 h-2 bg-surface0 rounded-full">
          <div className="h-full rounded-full bg-gradient-to-r from-mauve to-blue animate-pulse-slow"></div>
        </div>
      </div>
      
      {/* Blinking dot */}
      <div className="absolute right-3 bottom-3 w-2 h-2 rounded-full bg-green animate-pulse-slow"></div>
    </div>
  );
};

export default MusicPlayer;
