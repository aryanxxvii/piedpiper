
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
    <div className="min-h-screen w-full flex items-center justify-center bg-crust">
      {/* Background grid pattern */}
      <div className="fixed top-0 left-0 right-0 bottom-0 grid grid-cols-[repeat(40,1fr)] grid-rows-[repeat(25,1fr)] opacity-10 pointer-events-none">
        {Array.from({ length: 40 * 25 }).map((_, i) => (
          <div key={i} className="flex items-center justify-center text-[0.4rem] text-overlay0">
            {Math.random() > 0.98 ? "·" : ""}
          </div>
        ))}
      </div>
      
      {/* Main todo list */}
      <div className="container mx-auto px-4 flex items-center justify-center max-w-md">
        <TodoList />
      </div>
      
      {/* Music controls - bottom left */}
      <MusicControls />
      
      {/* Time elapsed - bottom center */}
      <TimeElapsed />
      
      {/* Seed display - below time elapsed */}
      <SeedDisplay />
      
      {/* Animated Coffee Cup - bottom right */}
      <div className="fixed bottom-4 right-4 z-40">
        <CoffeeAscii />
      </div>
    </div>
  );
};

export default Index;
