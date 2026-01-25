/**
 * NavCubePlugin - Professional 3D Navigation Cube for xeokit viewer
 * 
 * Features:
 * - Real 3D perspective rendering with proper face sorting
 * - Smooth hover effects with gradient shading
 * - Interactive click navigation to fly camera to faces
 * - Drop shadows and edge highlighting for professional look
 * - Synchronized camera orientation display
 */
(function(global) {
  'use strict';

  // Face definitions with camera positions
  const FACES = {
    front:  { eye: [0, 0, 1],  look: [0, 0, 0], up: [0, 1, 0], label: 'FRONT' },
    back:   { eye: [0, 0, -1], look: [0, 0, 0], up: [0, 1, 0], label: 'BACK' },
    top:    { eye: [0, 1, 0],  look: [0, 0, 0], up: [0, 0, -1], label: 'TOP' },
    bottom: { eye: [0, -1, 0], look: [0, 0, 0], up: [0, 0, 1], label: 'BOTTOM' },
    right:  { eye: [1, 0, 0],  look: [0, 0, 0], up: [0, 1, 0], label: 'RIGHT' },
    left:   { eye: [-1, 0, 0], look: [0, 0, 0], up: [0, 1, 0], label: 'LEFT' }
  };

  // Edge definitions (connecting two faces)
  const EDGES = [
    { faces: ['front', 'top'], eye: [0, 0.707, 0.707] },
    { faces: ['front', 'bottom'], eye: [0, -0.707, 0.707] },
    { faces: ['front', 'left'], eye: [-0.707, 0, 0.707] },
    { faces: ['front', 'right'], eye: [0.707, 0, 0.707] },
    { faces: ['back', 'top'], eye: [0, 0.707, -0.707] },
    { faces: ['back', 'bottom'], eye: [0, -0.707, -0.707] },
    { faces: ['back', 'left'], eye: [-0.707, 0, -0.707] },
    { faces: ['back', 'right'], eye: [0.707, 0, -0.707] },
    { faces: ['top', 'left'], eye: [-0.707, 0.707, 0] },
    { faces: ['top', 'right'], eye: [0.707, 0.707, 0] },
    { faces: ['bottom', 'left'], eye: [-0.707, -0.707, 0] },
    { faces: ['bottom', 'right'], eye: [0.707, -0.707, 0] }
  ];

  class NavCubePlugin {
    constructor(viewer, cfg = {}) {
      this.viewer = viewer;
      this.id = cfg.id || 'NavCubePlugin';
      this._visible = cfg.visible !== false;
      this._cameraFly = cfg.cameraFly !== false;
      this._cameraFlyDuration = cfg.cameraFlyDuration || 0.5;
      
      // Professional color scheme
      this._faceColors = {
        front:  cfg.frontColor  || '#4CAF50',  // Green
        back:   cfg.backColor   || '#E53935',  // Red
        top:    cfg.topColor    || '#2196F3',  // Blue
        bottom: cfg.bottomColor || '#FF9800',  // Orange
        left:   cfg.leftColor   || '#9C27B0',  // Purple
        right:  cfg.rightColor  || '#00BCD4'   // Cyan
      };
      this._hoverColor = cfg.hoverColor || '#FFC107';
      this._edgeColor = cfg.edgeColor || '#333333';
      this._shadowColor = 'rgba(0, 0, 0, 0.3)';
      
      this._canvas = document.getElementById(cfg.canvasId);
      if (!this._canvas) {
        console.error('NavCubePlugin: Canvas not found:', cfg.canvasId);
        return;
      }
      
      this._ctx = this._canvas.getContext('2d');
      this._hoveredFace = null;
      this._cubeSize = 35;
      this._destroyed = false;
      this._lastProjectedFaces = [];
      
      this._bindEvents();
      this._startRenderLoop();
    }
    
    _bindEvents() {
      if (!this._canvas) return;
      
      this._onMouseMove = (e) => {
        const rect = this._canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (this._canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (this._canvas.height / rect.height);
        this._hoveredFace = this._hitTest(x, y);
        this._canvas.style.cursor = this._hoveredFace ? 'pointer' : 'default';
      };
      
      this._onClick = (e) => {
        const rect = this._canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (this._canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (this._canvas.height / rect.height);
        const face = this._hitTest(x, y);
        if (face) {
          this._flyToFace(face);
        }
      };
      
      this._onMouseLeave = () => {
        this._hoveredFace = null;
        this._canvas.style.cursor = 'default';
      };
      
      // Touch support
      this._onTouchStart = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = this._canvas.getBoundingClientRect();
        const x = (touch.clientX - rect.left) * (this._canvas.width / rect.width);
        const y = (touch.clientY - rect.top) * (this._canvas.height / rect.height);
        const face = this._hitTest(x, y);
        if (face) {
          this._flyToFace(face);
        }
      };
      
      this._canvas.addEventListener('mousemove', this._onMouseMove);
      this._canvas.addEventListener('click', this._onClick);
      this._canvas.addEventListener('mouseleave', this._onMouseLeave);
      this._canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    }
    
    _hitTest(x, y) {
      // Test against rendered faces (back to front, so check front first)
      for (let i = this._lastProjectedFaces.length - 1; i >= 0; i--) {
        const face = this._lastProjectedFaces[i];
        if (this._pointInPolygon(x, y, face.points)) {
          return face.name;
        }
      }
      return null;
    }
    
    _pointInPolygon(x, y, points) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    }
    
    _flyToFace(faceName) {
      const face = FACES[faceName];
      if (!face || !this.viewer) return;
      
      const camera = this.viewer.camera;
      const scene = this.viewer.scene;
      if (!camera || !scene) return;
      
      // Get scene center and size for positioning
      let aabb;
      try {
        aabb = scene.getAABB ? scene.getAABB() : null;
      } catch (e) {
        aabb = null;
      }
      
      if (!aabb) {
        aabb = [-10, -10, -10, 10, 10, 10];
      }
      
      const center = [
        (aabb[0] + aabb[3]) / 2,
        (aabb[1] + aabb[4]) / 2,
        (aabb[2] + aabb[5]) / 2
      ];
      const diagonal = Math.sqrt(
        Math.pow(aabb[3] - aabb[0], 2) +
        Math.pow(aabb[4] - aabb[1], 2) +
        Math.pow(aabb[5] - aabb[2], 2)
      );
      const dist = diagonal * 1.2;
      
      const eye = [
        center[0] + face.eye[0] * dist,
        center[1] + face.eye[1] * dist,
        center[2] + face.eye[2] * dist
      ];
      
      // Use cameraFlight if available, otherwise set directly
      if (this._cameraFly && this.viewer.cameraFlight) {
        this.viewer.cameraFlight.flyTo({
          eye: eye,
          look: center,
          up: face.up,
          duration: this._cameraFlyDuration
        });
      } else {
        // Direct camera set
        camera.eye = eye;
        camera.look = center;
        camera.up = face.up;
      }
    }
    
    _startRenderLoop() {
      const render = () => {
        if (this._destroyed) return;
        if (this._visible) {
          this._draw();
        }
        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    }
    
    _draw() {
      if (!this._ctx || !this._canvas) return;
      
      const ctx = this._ctx;
      const w = this._canvas.width;
      const h = this._canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const size = this._cubeSize;
      
      // Clear with transparent background
      ctx.clearRect(0, 0, w, h);
      
      // Get camera orientation from viewer
      let rotX = -0.5, rotY = 0.7; // Default view angle
      if (this.viewer && this.viewer.camera) {
        const camera = this.viewer.camera;
        const eye = camera.eye;
        const look = camera.look;
        if (eye && look) {
          const dx = eye[0] - look[0];
          const dy = eye[1] - look[1];
          const dz = eye[2] - look[2];
          rotY = Math.atan2(dx, dz);
          const dist = Math.sqrt(dx * dx + dz * dz);
          rotX = Math.atan2(dy, dist);
        }
      }
      
      // Draw drop shadow
      ctx.save();
      ctx.shadowColor = this._shadowColor;
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;
      
      // Draw the 3D cube
      this._drawCube3D(ctx, cx, cy, size, rotX, rotY);
      
      ctx.restore();
    }
    
    _drawCube3D(ctx, cx, cy, size, rotX, rotY) {
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      
      // Cube vertices (normalized -1 to 1)
      const vertices = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], // Back face
        [-1, -1, 1],  [1, -1, 1],  [1, 1, 1],  [-1, 1, 1]   // Front face
      ];
      
      // Project vertices to 2D with perspective
      const projected = vertices.map(v => {
        // Rotate around Y axis
        let x = v[0] * cosY - v[2] * sinY;
        let z = v[0] * sinY + v[2] * cosY;
        let y = v[1];
        
        // Rotate around X axis
        const y2 = y * cosX - z * sinX;
        z = y * sinX + z * cosX;
        y = y2;
        
        // Perspective projection
        const perspective = 3;
        const scale = perspective / (perspective + z * 0.3);
        
        return {
          x: cx + x * size * scale,
          y: cy - y * size * scale,
          z: z
        };
      });
      
      // Face definitions with vertex indices
      const faces = [
        { verts: [0, 1, 2, 3], name: 'back', normal: [0, 0, -1] },
        { verts: [4, 7, 6, 5], name: 'front', normal: [0, 0, 1] },
        { verts: [3, 2, 6, 7], name: 'top', normal: [0, 1, 0] },
        { verts: [0, 4, 5, 1], name: 'bottom', normal: [0, -1, 0] },
        { verts: [0, 3, 7, 4], name: 'left', normal: [-1, 0, 0] },
        { verts: [1, 5, 6, 2], name: 'right', normal: [1, 0, 0] }
      ];
      
      // Calculate face visibility and depth, then sort
      const visibleFaces = faces.map(f => {
        // Rotate normal
        let nx = f.normal[0] * cosY - f.normal[2] * sinY;
        let nz = f.normal[0] * sinY + f.normal[2] * cosY;
        let ny = f.normal[1];
        const ny2 = ny * cosX - nz * sinX;
        nz = ny * sinX + nz * cosX;
        
        // Calculate center depth
        const centerZ = f.verts.reduce((sum, i) => sum + projected[i].z, 0) / 4;
        
        // Get projected points
        const points = f.verts.map(i => ({ x: projected[i].x, y: projected[i].y }));
        
        return { ...f, depth: centerZ, visible: nz > -0.15, points };
      }).filter(f => f.visible).sort((a, b) => a.depth - b.depth);
      
      // Store for hit testing
      this._lastProjectedFaces = visibleFaces;
      
      // Draw faces back to front
      visibleFaces.forEach(face => {
        const points = face.points;
        const isHovered = this._hoveredFace === face.name;
        
        // Create path
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
        
        // Fill with gradient for 3D effect
        const baseColor = isHovered ? this._hoverColor : this._faceColors[face.name];
        const gradient = this._createFaceGradient(ctx, points, baseColor, face.depth);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Draw edges
        ctx.strokeStyle = this._edgeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        // Draw face label
        this._drawFaceLabel(ctx, points, face.name, isHovered);
      });
    }
    
    _createFaceGradient(ctx, points, baseColor, depth) {
      // Calculate bounding box
      const minX = Math.min(...points.map(p => p.x));
      const maxX = Math.max(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y));
      const maxY = Math.max(...points.map(p => p.y));
      
      const gradient = ctx.createLinearGradient(minX, minY, maxX, maxY);
      
      // Parse base color and create lighter/darker variants
      const lighterColor = this._adjustColorBrightness(baseColor, 30);
      const darkerColor = this._adjustColorBrightness(baseColor, -20);
      
      gradient.addColorStop(0, lighterColor);
      gradient.addColorStop(1, darkerColor);
      
      return gradient;
    }
    
    _adjustColorBrightness(hex, percent) {
      // Remove # if present
      hex = hex.replace(/^#/, '');
      
      // Parse RGB
      let r = parseInt(hex.substr(0, 2), 16);
      let g = parseInt(hex.substr(2, 2), 16);
      let b = parseInt(hex.substr(4, 2), 16);
      
      // Adjust brightness
      r = Math.min(255, Math.max(0, r + (r * percent / 100)));
      g = Math.min(255, Math.max(0, g + (g * percent / 100)));
      b = Math.min(255, Math.max(0, b + (b * percent / 100)));
      
      // Convert back to hex
      return '#' + 
        Math.round(r).toString(16).padStart(2, '0') +
        Math.round(g).toString(16).padStart(2, '0') +
        Math.round(b).toString(16).padStart(2, '0');
    }
    
    _drawFaceLabel(ctx, points, faceName, isHovered) {
      // Calculate center of face
      const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      
      // Calculate face size for font scaling
      const width = Math.abs(points[1].x - points[0].x) + Math.abs(points[2].x - points[1].x);
      const fontSize = Math.max(8, Math.min(12, width / 4));
      
      // Draw label with shadow for readability
      ctx.save();
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Label text
      const labels = {
        front: 'F',
        back: 'B', 
        top: 'T',
        bottom: 'Bo',
        left: 'L',
        right: 'R'
      };
      const label = labels[faceName] || '';
      
      // Text shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillText(label, centerX + 1, centerY + 1);
      
      // Text
      ctx.fillStyle = isHovered ? '#000000' : '#FFFFFF';
      ctx.fillText(label, centerX, centerY);
      
      ctx.restore();
    }
    
    setVisible(visible) {
      this._visible = visible;
      if (this._canvas) {
        this._canvas.style.display = visible ? 'block' : 'none';
      }
    }
    
    getVisible() {
      return this._visible;
    }
    
    destroy() {
      this._destroyed = true;
      if (this._canvas) {
        this._canvas.removeEventListener('mousemove', this._onMouseMove);
        this._canvas.removeEventListener('click', this._onClick);
        this._canvas.removeEventListener('mouseleave', this._onMouseLeave);
        this._canvas.removeEventListener('touchstart', this._onTouchStart);
      }
    }
  }
  
  // Export to global scope
  global.NavCubePlugin = NavCubePlugin;
  
})(typeof window !== 'undefined' ? window : this);
