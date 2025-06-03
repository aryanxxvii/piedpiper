
import React, { useState, useEffect } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import audioEngine from '@/utils/audioEngine';

const MusicControls: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.4);
  const [muted, setMuted] = useState(false);
  
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
  
  return (
    <div className="fixed bottom-4 left-4 flex items-center gap-3 z-40">
      <Button 
        variant="outline" 
        size="sm" 
        onClick={togglePlayback}
        className="bg-surface0 hover:bg-surface1 border-none"
      >
        {isPlaying ? (
          <Pause size={16} />
        ) : (
          <Play size={16} />
        )}
      </Button>
      
      <div className="flex items-center gap-2">
        <button
          onClick={toggleMute}
          className="text-overlay1 hover:text-text transition-colors"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        
        <div className="w-20">
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
  );
};

export default MusicControls;
