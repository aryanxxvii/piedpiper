
import React, { useState, useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import audioEngine from '@/utils/audioEngine';

const TodoList: React.FC = () => {
  const [todos, setTodos] = useState([
    { id: 1, text: 'Listen to some lofi beats', completed: false },
    { id: 2, text: 'Focus on deep work', completed: false },
    { id: 3, text: 'Take a mindful break', completed: true },
  ]);
  const [newTodo, setNewTodo] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.4);
  const [muted, setMuted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keys when input is focused
      if (showAddInput && document.activeElement === inputRef.current) {
        if (e.key === 'Escape') {
          setShowAddInput(false);
          setNewTodo('');
        }
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlayback();
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(0, prev - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(todos.length - 1, prev + 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (todos.length > 0) {
            toggleTodo(todos[selectedIndex].id);
          }
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          setShowAddInput(true);
          setTimeout(() => inputRef.current?.focus(), 0);
          break;
        case '+':
        case '=':
          e.preventDefault();
          adjustVolume(0.1);
          break;
        case '-':
        case '_':
          e.preventDefault();
          adjustVolume(-0.1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [todos, selectedIndex, showAddInput, volume, muted]);

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

  const adjustVolume = (delta: number) => {
    const newVolume = Math.max(0, Math.min(1, volume + delta));
    setVolume(newVolume);
    if (muted && newVolume > 0) {
      setMuted(false);
    }
  };

  const addTodo = () => {
    if (newTodo.trim()) {
      setTodos([...todos, { 
        id: Date.now(), 
        text: newTodo.trim(), 
        completed: false 
      }]);
      setNewTodo('');
      setShowAddInput(false);
    }
  };

  const toggleTodo = (id: number) => {
    setTodos(todos.map(todo => 
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };

  const deleteTodo = (id: number) => {
    setTodos(todos.filter(todo => todo.id !== id));
    if (selectedIndex >= todos.length - 1) {
      setSelectedIndex(Math.max(0, todos.length - 2));
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      addTodo();
    }
  };

  return (
    <div className="w-full max-w-md mx-auto bg-mantle rounded-lg p-6">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-mauve mb-2">## Focus Tasks</h2>
        <p className="text-sm text-subtext0">Keep track of what matters</p>
      </div>

      {/* Todo list */}
      <div className="space-y-2 mb-4">
        {todos.map((todo, index) => (
          <div 
            key={todo.id} 
            className={`flex items-center gap-3 p-2 rounded transition-colors ${
              index === selectedIndex ? 'bg-surface0' : 'hover:bg-surface0'
            }`}
          >
            <button
              onClick={() => toggleTodo(todo.id)}
              className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                todo.completed 
                  ? 'bg-green border-green' 
                  : 'border-surface2 hover:border-subtext0'
              }`}
            >
              {todo.completed && (
                <span className="text-base text-xs">✓</span>
              )}
            </button>
            <span 
              className={`flex-1 text-sm ${
                todo.completed 
                  ? 'text-subtext0 line-through' 
                  : 'text-text'
              }`}
            >
              {todo.text}
            </span>
            <button
              onClick={() => deleteTodo(todo.id)}
              className="text-subtext0 hover:text-red transition-colors opacity-0 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Add new todo input */}
      {showAddInput && (
        <div className="mb-4">
          <Input
            ref={inputRef}
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Add a new task..."
            className="bg-surface0 border-surface2 text-text placeholder:text-subtext0"
          />
        </div>
      )}

      {/* Add button */}
      <div className="flex justify-center">
        <Button 
          onClick={() => {
            if (showAddInput) {
              addTodo();
            } else {
              setShowAddInput(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }}
          size="sm"
          className="bg-surface0 hover:bg-surface1 border-surface2 w-8 h-8 p-0"
        >
          <Plus size={16} />
        </Button>
      </div>

      {todos.length === 0 && (
        <div className="text-center py-6 text-subtext0 text-sm">
          No tasks yet. Press N to add one.
        </div>
      )}

      {/* Keyboard shortcuts hint */}
      <div className="mt-6 text-xs text-subtext0 text-center">
        <p>Space: play/pause • ±: volume • ↑↓: navigate • Enter: toggle • N: new task</p>
      </div>
    </div>
  );
};

export default TodoList;
