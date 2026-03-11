import React, { useRef, useEffect } from "react";

interface Particle {
  theta: number;
  phi: number;
  radius: number;
  char: string;
  size: number;
  speed: number;
  opacity: number;
}

const CHARS = "0123456789ABCDEF∞∑∂∇".split("");

function createParticles(count: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      theta: Math.random() * Math.PI * 2,
      phi: Math.acos(2 * Math.random() - 1),
      radius: 0.85 + Math.random() * 0.3,
      char: CHARS[Math.floor(Math.random() * CHARS.length)],
      size: 8 + Math.random() * 6,
      speed: 0.15 + Math.random() * 0.25,
      opacity: 0.3 + Math.random() * 0.7,
    });
  }
  return particles;
}

export default function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isMobile = window.innerWidth < 768;
    const particles = createParticles(isMobile ? 150 : 280);
    let rotation = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const cx = w / 2;
      const cy = h / 2;
      const sphereR = Math.min(w, h) * 0.32;

      ctx.clearRect(0, 0, w, h);

      // Subtle glow behind sphere
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, sphereR * 1.6);
      glow.addColorStop(0, "hsla(180, 70%, 40%, 0.08)");
      glow.addColorStop(0.5, "hsla(180, 70%, 30%, 0.03)");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      rotation += 0.002;

      // Sort by z for depth
      const projected = particles.map((p) => {
        const t = p.theta + rotation * p.speed;
        const x3 = p.radius * Math.sin(p.phi) * Math.cos(t);
        const y3 = p.radius * Math.cos(p.phi);
        const z3 = p.radius * Math.sin(p.phi) * Math.sin(t);

        const perspective = 1 / (1 - z3 * 0.3);
        const sx = cx + x3 * sphereR * perspective;
        const sy = cy + y3 * sphereR * perspective;
        const depth = (z3 + 1) / 2; // 0 = far, 1 = near

        return { ...p, sx, sy, depth, z3 };
      });

      projected.sort((a, b) => a.z3 - b.z3);

      for (const p of projected) {
        const alpha = p.opacity * (0.15 + p.depth * 0.85);
        const size = p.size * (0.6 + p.depth * 0.4);

        // Teal/cyan color with depth-based brightness
        const lightness = 45 + p.depth * 25;
        ctx.fillStyle = `hsla(180, 65%, ${lightness}%, ${alpha})`;
        ctx.font = `${size}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.char, p.sx, p.sy);
      }

      // Thin ring around sphere equator
      ctx.beginPath();
      ctx.ellipse(cx, cy, sphereR * 1.05, sphereR * 0.2, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "hsla(180, 60%, 50%, 0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    />
  );
}
