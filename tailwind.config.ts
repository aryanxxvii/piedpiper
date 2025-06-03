
import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			fontFamily: {
				mono: ['Chivo Mono', 'monospace'],
				sans: ['Chivo Mono', 'monospace'],
				serif: ['Chivo Mono', 'monospace'],
			},
			colors: {
				// Catppuccin Mocha colors
				base: '#1e1e2e', // base background
				mantle: '#181825', // darker background
				crust: '#11111b', // darkest background
				text: '#cdd6f4', // main text
				subtext0: '#a6adc8', // subtle text
				subtext1: '#bac2de', // less subtle text
				surface0: '#313244', // surface colors
				surface1: '#45475a',
				surface2: '#585b70',
				overlay0: '#6c7086', // overlays
				overlay1: '#7f849c',
				overlay2: '#9399b2',
				blue: '#89b4fa', // accent colors
				lavender: '#b4befe',
				sapphire: '#74c7ec',
				sky: '#89dceb',
				teal: '#94e2d5',
				green: '#a6e3a1',
				yellow: '#f9e2af',
				peach: '#fab387',
				maroon: '#eba0ac',
				red: '#f38ba8',
				mauve: '#cba6f7',
				pink: '#f5c2e7',
				flamingo: '#f2cdcd',
				rosewater: '#f5e0dc',

				// Original shadcn styles maintained for components
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: '#1e1e2e', // base
				foreground: '#cdd6f4', // text
				primary: {
					DEFAULT: '#cba6f7', // mauve
					foreground: '#1e1e2e', // base
				},
				secondary: {
					DEFAULT: '#313244', // surface0
					foreground: '#cdd6f4', // text
				},
				destructive: {
					DEFAULT: '#f38ba8', // red
					foreground: '#1e1e2e', // base
				},
				muted: {
					DEFAULT: '#45475a', // surface1
					foreground: '#bac2de', // subtext1
				},
				accent: {
					DEFAULT: '#f5c2e7', // pink 
					foreground: '#1e1e2e', // base
				},
				popover: {
					DEFAULT: '#181825', // mantle
					foreground: '#cdd6f4', // text
				},
				card: {
					DEFAULT: '#1e1e2e', // base
					foreground: '#cdd6f4', // text
				},
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				},
				'steam': {
					'0%, 100%': { transform: 'translateY(0) scale(1)', opacity: '0.7' },
					'50%': { transform: 'translateY(-10px) scale(1.1)', opacity: '0.4' },
				},
				'fade-in': {
					'0%': { opacity: '0' },
					'100%': { opacity: '1' },
				},
				'fade-out': {
					'0%': { opacity: '1' },
					'100%': { opacity: '0' },
				},
				'pulse-slow': {
					'0%, 100%': { opacity: '1' },
					'50%': { opacity: '0.7' },
				},
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'steam': 'steam 3s ease-in-out infinite',
				'steam-alt': 'steam 2.5s ease-in-out infinite',
				'fade-in': 'fade-in 0.5s ease-in',
				'fade-out': 'fade-out 0.5s ease-out',
				'pulse-slow': 'pulse-slow 4s ease-in-out infinite',
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
