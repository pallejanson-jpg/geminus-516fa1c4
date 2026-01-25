/**
 * NavCubePlugin - Standalone navigation cube for xeokit viewer
 * Based on xeokit-sdk NavCubePlugin but simplified for external use
 * 
 * This plugin provides a 3D cube gizmo that shows the current camera orientation
 * and allows clicking faces/edges/corners to rotate the camera.
 */
(function(global) {
  'use strict';

  const math = {
    vec3: function(values) { return values ? [...values] : [0, 0, 0]; },
    mat4: function() { return new Float32Array(16); },
    identityMat4: function(m) {
      m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
      m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
      m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
      m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
      return m;
    },
    mulMat4: function(a, b, dest) {
      dest = dest || new Float32Array(16);
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      dest[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      dest[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      dest[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      dest[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
      b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
      dest[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      dest[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      dest[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      dest[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
      b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
      dest[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      dest[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      dest[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      dest[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
      b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
      dest[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      dest[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      dest[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      dest[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
      return dest;
    }
  };

  // Face definitions with camera positions
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
      this._synchProjection = cfg.synchProjection || false;
      
      // Colors
      this._cubeColor = cfg.color || '#CFCFCF';
      this._frontColor = cfg.frontColor || '#55FF55';
      this._backColor = cfg.backColor || '#FF5555';
      this._leftColor = cfg.leftColor || '#FFAA00';
      this._rightColor = cfg.rightColor || '#00AAFF';
      this._topColor = cfg.topColor || '#7777FF';
      this._bottomColor = cfg.bottomColor || '#FFFF55';
      this._hoverColor = cfg.hoverColor || '#00AAFF';
      
      this._canvas = document.getElementById(cfg.canvasId);
      if (!this._canvas) {
        console.error('NavCubePlugin: Canvas not found:', cfg.canvasId);
        return;
      }
      
      this._ctx = this._canvas.getContext('2d');
      this._hoveredFace = null;
      this._cubeSize = 40;
      this._destroyed = false;
      
      this._bindEvents();
      this._startRenderLoop();
    }
    
    _bindEvents() {
      if (!this._canvas) return;
      
      this._onMouseMove = (e) => {
        const rect = this._canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this._hoveredFace = this._hitTest(x, y);
        this._canvas.style.cursor = this._hoveredFace ? 'pointer' : 'default';
      };
      
      this._onClick = (e) => {
        const rect = this._canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const face = this._hitTest(x, y);
        if (face) {
          this._flyToFace(face);
        }
      };
      
      this._onMouseLeave = () => {
        this._hoveredFace = null;
        this._canvas.style.cursor = 'default';
      };
      
      this._canvas.addEventListener('mousemove', this._onMouseMove);
      this._canvas.addEventListener('click', this._onClick);
      this._canvas.addEventListener('mouseleave', this._onMouseLeave);
    }
    
    _hitTest(x, y) {
      const w = this._canvas.width;
      const h = this._canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const size = this._cubeSize;
      
      // Simple hit regions for cube faces
      const regions = {
        front:  { x: cx - size/2, y: cy - size/2, w: size, h: size },
        top:    { x: cx - size/2, y: cy - size - 10, w: size, h: 15 },
        bottom: { x: cx - size/2, y: cy + size/2 - 5, w: size, h: 15 },
        left:   { x: cx - size - 10, y: cy - size/2, w: 15, h: size },
        right:  { x: cx + size/2 - 5, y: cy - size/2, w: 15, h: size }
      };
      
      for (const [face, r] of Object.entries(regions)) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          return face;
        }
      }
      return null;
    }
    
    _flyToFace(faceName) {
      const face = FACES[faceName];
      if (!face || !this.viewer) return;
      
      const camera = this.viewer.camera;
      const scene = this.viewer.scene;
      if (!camera || !scene) return;
      
      // Get scene center and size for positioning
      const aabb = scene.getAABB ? scene.getAABB() : [-10, -10, -10, 10, 10, 10];
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
          eye: eye,
          look: center,
          up: face.up,
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
      
      // Clear canvas
      ctx.clearRect(0, 0, w, h);
      
      // Get camera orientation
      let rotX = 0, rotY = 0;
      if (this.viewer && this.viewer.camera) {
        const camera = this.viewer.camera;
        const eye = camera.eye;
        const look = camera.look;
        const dx = eye[0] - look[0];
        const dy = eye[1] - look[1];
        const dz = eye[2] - look[2];
        rotY = Math.atan2(dx, dz);
        const dist = Math.sqrt(dx*dx + dz*dz);
        rotX = Math.atan2(dy, dist);
      }
      
      // Draw isometric cube based on camera orientation
      this._drawCube(ctx, cx, cy, size, rotX, rotY);
    }
    
    _drawCube(ctx, cx, cy, size, rotX, rotY) {
      // Simplified isometric cube representation
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      
      // Cube vertices (normalized)
      const vertices = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
      ];
      
      // Project vertices
      const projected = vertices.map(v => {
        // Rotate around Y
        let x = v[0] * cosY - v[2] * sinY;
        let z = v[0] * sinY + v[2] * cosY;
        let y = v[1];
        
        // Rotate around X  
        const y2 = y * cosX - z * sinX;
        z = y * sinX + z * cosX;
        y = y2;
        
        // Isometric projection
        return {
          x: cx + x * size * 0.5,
          y: cy - y * size * 0.5 + z * size * 0.1
        };
      });
      
      // Faces with vertex indices and colors
      const faces = [
        { verts: [0, 1, 2, 3], color: this._backColor, name: 'back', normal: [0, 0, -1] },
        { verts: [4, 5, 6, 7], color: this._frontColor, name: 'front', normal: [0, 0, 1] },
        { verts: [3, 2, 6, 7], color: this._topColor, name: 'top', normal: [0, 1, 0] },
        { verts: [0, 1, 5, 4], color: this._bottomColor, name: 'bottom', normal: [0, -1, 0] },
        { verts: [0, 3, 7, 4], color: this._leftColor, name: 'left', normal: [-1, 0, 0] },
        { verts: [1, 2, 6, 5], color: this._rightColor, name: 'right', normal: [1, 0, 0] }
      ];
      
      // Calculate face visibility and sort by depth
      const visibleFaces = faces.map(f => {
        // Rotate normal
        let nx = f.normal[0] * cosY - f.normal[2] * sinY;
        let nz = f.normal[0] * sinY + f.normal[2] * cosY;
        let ny = f.normal[1];
        const ny2 = ny * cosX - nz * sinX;
        nz = ny * sinX + nz * cosX;
        
        return { ...f, depth: nz, visible: nz > -0.1 };
      }).filter(f => f.visible).sort((a, b) => a.depth - b.depth);
      
      // Draw faces
      visibleFaces.forEach(face => {
        ctx.beginPath();
        const p0 = projected[face.verts[0]];
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < face.verts.length; i++) {
          const p = projected[face.verts[i]];
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        
        // Fill color (highlight if hovered)
        ctx.fillStyle = this._hoveredFace === face.name ? this._hoverColor : face.color;
        ctx.fill();
        
        // Outline
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Face label
        const centerX = face.verts.reduce((sum, i) => sum + projected[i].x, 0) / 4;
        const centerY = face.verts.reduce((sum, i) => sum + projected[i].y, 0) / 4;
        
        ctx.fillStyle = '#333';
        ctx.font = 'bold 8px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const labels = { front: 'F', back: 'B', top: 'T', bottom: 'Bo', left: 'L', right: 'R' };
        ctx.fillText(labels[face.name] || '', centerX, centerY);
      });
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
      }
    }
  }
  
  // Export to global scope
  global.NavCubePlugin = NavCubePlugin;
  
})(typeof window !== 'undefined' ? window : this);
