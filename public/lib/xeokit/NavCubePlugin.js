/**
 * NavCubePlugin - 3D Navigation Cube for xeokit viewer
 * 
 * Classic cube design with distinct face shading, full labels, and hover highlights.
 * Synchronized camera orientation. Click to fly to face.
 */
(function(global) {
  'use strict';

  const FACES = {
    front:  { eye: [0, 0, 1],  look: [0, 0, 0], up: [0, 1, 0], label: 'FRONT' },
    back:   { eye: [0, 0, -1], look: [0, 0, 0], up: [0, 1, 0], label: 'BACK' },
    top:    { eye: [0, 1, 0],  look: [0, 0, 0], up: [0, 0, -1], label: 'TOP' },
    bottom: { eye: [0, -1, 0], look: [0, 0, 0], up: [0, 0, 1], label: 'BOTTOM' },
    right:  { eye: [1, 0, 0],  look: [0, 0, 0], up: [0, 1, 0], label: 'RIGHT' },
    left:   { eye: [-1, 0, 0], look: [0, 0, 0], up: [0, 1, 0], label: 'LEFT' }
  };

  class NavCubePlugin {
    constructor(viewer, cfg = {}) {
      this.viewer = viewer;
      this.id = cfg.id || 'NavCubePlugin';
      this._visible = cfg.visible !== false;
      this._cameraFly = cfg.cameraFly !== false;
      this._cameraFlyDuration = cfg.cameraFlyDuration || 0.5;
      
      this._canvas = document.getElementById(cfg.canvasId);
      if (!this._canvas) {
        console.error('NavCubePlugin: Canvas not found:', cfg.canvasId);
        return;
      }
      
      this._ctx = this._canvas.getContext('2d');
      this._hoveredFace = null;
      this._cubeSize = 36;
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
        if (face) this._flyToFace(face);
      };
      
      this._onMouseLeave = () => {
        this._hoveredFace = null;
        this._canvas.style.cursor = 'default';
      };
      
      this._onTouchStart = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = this._canvas.getBoundingClientRect();
        const x = (touch.clientX - rect.left) * (this._canvas.width / rect.width);
        const y = (touch.clientY - rect.top) * (this._canvas.height / rect.height);
        const face = this._hitTest(x, y);
        if (face) this._flyToFace(face);
      };
      
      this._canvas.addEventListener('mousemove', this._onMouseMove);
      this._canvas.addEventListener('click', this._onClick);
      this._canvas.addEventListener('mouseleave', this._onMouseLeave);
      this._canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    }
    
    _hitTest(x, y) {
      for (let i = this._lastProjectedFaces.length - 1; i >= 0; i--) {
        const face = this._lastProjectedFaces[i];
        if (this._pointInPolygon(x, y, face.points)) return face.name;
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
      
      let aabb;
      try { aabb = scene.getAABB ? scene.getAABB() : null; } catch (e) { aabb = null; }
      if (!aabb) aabb = [-10, -10, -10, 10, 10, 10];
      
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
      
      if (this._cameraFly && this.viewer.cameraFlight) {
        this.viewer.cameraFlight.flyTo({
          eye, look: center, up: face.up,
          duration: this._cameraFlyDuration
        });
      } else {
        camera.eye = eye;
        camera.look = center;
        camera.up = face.up;
      }
    }
    
    _startRenderLoop() {
      const render = () => {
        if (this._destroyed) return;
        if (this._visible) this._draw();
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
      
      ctx.clearRect(0, 0, w, h);
      
      let rotX = -0.5, rotY = 0.7;
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
      
      this._drawCube3D(ctx, cx, cy, size, rotX, rotY);
    }
    
    _drawCube3D(ctx, cx, cy, size, rotX, rotY) {
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      
      const vertices = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1],  [1, -1, 1],  [1, 1, 1],  [-1, 1, 1]
      ];
      
      const projected = vertices.map(v => {
        let x = v[0] * cosY - v[2] * sinY;
        let z = v[0] * sinY + v[2] * cosY;
        let y = v[1];
        const y2 = y * cosX - z * sinX;
        z = y * sinX + z * cosX;
        y = y2;
        const perspective = 3;
        const scale = perspective / (perspective + z * 0.3);
        return { x: cx + x * size * scale, y: cy - y * size * scale, z };
      });
      
      const faces = [
        { verts: [0, 1, 2, 3], name: 'back', normal: [0, 0, -1] },
        { verts: [4, 7, 6, 5], name: 'front', normal: [0, 0, 1] },
        { verts: [3, 2, 6, 7], name: 'top', normal: [0, 1, 0] },
        { verts: [0, 4, 5, 1], name: 'bottom', normal: [0, -1, 0] },
        { verts: [0, 3, 7, 4], name: 'left', normal: [-1, 0, 0] },
        { verts: [1, 5, 6, 2], name: 'right', normal: [1, 0, 0] }
      ];
      
      const visibleFaces = faces.map(f => {
        let nx = f.normal[0] * cosY - f.normal[2] * sinY;
        let nz = f.normal[0] * sinY + f.normal[2] * cosY;
        let ny = f.normal[1];
        const ny2 = ny * cosX - nz * sinX;
        nz = ny * sinX + nz * cosX;
        const centerZ = f.verts.reduce((sum, i) => sum + projected[i].z, 0) / 4;
        const points = f.verts.map(i => ({ x: projected[i].x, y: projected[i].y }));
        return { ...f, depth: centerZ, visible: nz > -0.15, points };
      }).filter(f => f.visible).sort((a, b) => a.depth - b.depth);
      
      this._lastProjectedFaces = visibleFaces;
      
      visibleFaces.forEach(face => {
        const points = face.points;
        const isHovered = this._hoveredFace === face.name;
        
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        
        // Classic distinct face colors
        const colors = {
          top:    isHovered ? '#6a9fd8' : '#4a7fb8',
          bottom: isHovered ? '#5a7a9a' : '#3a5a7a',
          front:  isHovered ? '#5588bb' : '#3568a0',
          back:   isHovered ? '#4a7090' : '#2a5070',
          left:   isHovered ? '#4e80a8' : '#2e6088',
          right:  isHovered ? '#5890b8' : '#387098',
        };
        
        ctx.fillStyle = colors[face.name] || '#3568a0';
        ctx.fill();
        
        // Crisp edges
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Full face labels
        this._drawFaceLabel(ctx, points, face.name, isHovered);
      });
    }
    
    _drawFaceLabel(ctx, points, faceName, isHovered) {
      const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      
      const width = Math.abs(points[1].x - points[0].x) + Math.abs(points[2].x - points[1].x);
      const fontSize = Math.max(7, Math.min(10, width / 5));
      
      ctx.save();
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const labels = {
        front: 'FRONT', back: 'BACK', top: 'TOP',
        bottom: 'BTM', left: 'LEFT', right: 'RIGHT'
      };
      
      ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(255,255,255,0.75)';
      ctx.fillText(labels[faceName] || '', centerX, centerY);
      ctx.restore();
    }
    
    setVisible(visible) {
      this._visible = visible;
      if (this._canvas) this._canvas.style.display = visible ? 'block' : 'none';
    }
    
    getVisible() { return this._visible; }
    
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
  
  global.NavCubePlugin = NavCubePlugin;
})(typeof window !== 'undefined' ? window : this);
