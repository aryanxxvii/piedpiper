
import React, { useEffect } from "react";
import TodoList from "@/components/TodoList";
import MusicControls from "@/components/MusicControls";
import TimeElapsed from "@/components/TimeElapsed";
import SeedDisplay from "@/components/SeedDisplay";
import { CoffeeAscii } from "@/components/AsciiArt";
import audioEngine from "@/utils/audioEngine";

const Index = () => {
  useEffect(() => {
    // Clean up audio engine on unmount
    return () => {
      audioEngine.cleanup();
    };
  }, []);

  return (
    <div className="h-screen w-full flex 
    pb-32 items-center justify-center bg-crust selection:bg-mauve selection:bg-opacity-25 overflow-hidden">
      
      {/* Main todo list */}
      <div className="container mx-auto px-4 flex items-center justify-center max-w-md pt-0">
        <TodoList />
      </div>
      {/* Seed display - below time elapsed
      <SeedDisplay /> */}
      
      {/* Music controls - bottom left */}
      <MusicControls />
      
      {/* Time elapsed - bottom center */}
      {/* <TimeElapsed /> */}
      
      
      {/* Animated Coffee Cup - bottom right */}
      <div className="fixed bottom-4 right-4 z-40">
        <CoffeeAscii />
      </div>
    </div>
  );
};

export default Index;
