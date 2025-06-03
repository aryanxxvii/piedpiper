
import React, { useState, useEffect } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from "@/components/ui/button";
import audioEngine from '@/utils/audioEngine';

const MusicControls: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.4);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setIsPlaying(audioEngine.getIsPlaying());
    }, 100);
    
    return () => clearInterval(interval);
  }, []);
  
  const togglePlayback = async () => {
    if (isPlaying) {
      audioEngine.stop();
      setIsPlaying(false);
    } else {
      try {
        audioEngine.generateNewPatterns();
        await audioEngine.start();
        setIsPlaying(true);
      } catch (error) {
        console.error("Failed to start audio:", error);
      }
    }
  };
  
  const renderVolumeBar = () => {
    const totalBars = 10;
    const filledBars = Math.round(volume * totalBars);
    
    return (
      <div className="flex items-center gap-1">
        {Array.from({ length: totalBars }).map((_, index) => (
          <span
            key={index}
            className={`text-sm font-mono ${
              index < filledBars ? 'text-mauve' : 'text-surface2'
            }`}
          >
            {index < filledBars ? '+' : '-'}
          </span>
        ))}
      </div>
    );
  };

  // Listen for volume changes from keyboard
  useEffect(() => {
    const updateVolume = () => {
      setVolume(audioEngine.getVolume());
    };
    
    const interval = setInterval(updateVolume, 100);
    return () => clearInterval(interval);
  }, []);
  
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
      
      <div className="flex flex-col items-start gap-1">
        <span className="text-xs text-subtext0 font-mono">VOL</span>
        {renderVolumeBar()}
      </div>
    </div>
  );
};

export default MusicControls;
