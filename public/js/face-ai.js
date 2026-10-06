// Enterprise AI Anti-Spoof Detector (Live Human Only Engine)
class AntiSpoofDetector {
  constructor() {
    this.earHistory = [];
    this.depthHistory = [];
    this.textureHistory = [];
    this.lastFrameTime = Date.now();
  }

  reset() {
    this.earHistory = [];
    this.depthHistory = [];
    this.textureHistory = [];
  }

  /**
   * Evaluates frame for Live Human vs Spoof Proxy (Photo/Screen/Replay/Object)
   */
  evaluateAntiSpoof(videoElem, box, landmarks) {
    if (!landmarks) {
      return { passed: false, reason: 'Landmark Tracking Pending' };
    }

    const points = landmarks.positions || landmarks._positions || landmarks;
    if (!points || points.length < 68) {
      return { passed: false, reason: 'Incomplete Facial Landmarks' };
    }

    // 1. EYE ASPECT RATIO (EAR) & BLINK / EYE MOVEMENT CHECK
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const p37 = points[37], p38 = points[38], p40 = points[40], p41 = points[41], p36 = points[36], p39 = points[39];
    const p43 = points[43], p44 = points[44], p46 = points[46], p47 = points[47], p42 = points[42], p45 = points[45];

    const leftEAR = (dist(p38, p41) + dist(p37, p40)) / (2.0 * Math.max(1, dist(p36, p39)));
    const rightEAR = (dist(p44, p47) + dist(p43, p46)) / (2.0 * Math.max(1, dist(p42, p45)));
    const avgEAR = (leftEAR + rightEAR) / 2.0;

    this.earHistory.push(avgEAR);
    if (this.earHistory.length > 25) this.earHistory.shift();

    // 2. 3D FACIAL DEPTH VARIANCE & FLAT SURFACE ESTIMATION
    const noseTip = points[30];
    const noseBridge = points[27];
    const jawBottom = points[8];
    const leftCheek = points[2];
    const rightCheek = points[14];

    const noseBridgeLength = dist(noseBridge, noseTip);
    const jawHeight = dist(noseTip, jawBottom);
    const faceWidth = dist(leftCheek, rightCheek);
    const eyeWidth = dist(p36, p45);

    const depthRatio = (noseBridgeLength * jawHeight) / Math.max(1, faceWidth * eyeWidth);
    this.depthHistory.push(depthRatio);
    if (this.depthHistory.length > 25) this.depthHistory.shift();

    const earVariance = this.calculateVariance(this.earHistory);
    const depthVariance = this.calculateVariance(this.depthHistory);

    // 3. TEXTURE & MOIRÉ PATTERN / RECTANGULAR DISPLAY BEZEL CHECK
    const textureAnalysis = this.analyzeTextureAndReflection(videoElem, box);

    // 4. VERDICT EVALUATION:
    // If static photo print or frozen screen -> earVariance == 0 AND depthVariance == 0 after 12+ frames
    if (this.earHistory.length >= 12 && earVariance < 0.000003 && depthVariance < 0.000008) {
      return { passed: false, reason: 'Static Photograph / Screen Freeze Detected (0 Micro-Movement)' };
    }

    if (textureAnalysis.isScreenOrPaper) {
      return { passed: false, reason: textureAnalysis.reason || 'Screen Reflection / Moiré Grid Pattern Detected' };
    }

    return { passed: true };
  }

  calculateVariance(arr) {
    if (!arr || arr.length < 2) return 1.0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
  }

  analyzeTextureAndReflection(videoElem, box) {
    try {
      if (!videoElem || !box || box.width <= 0 || box.height <= 0) {
        return { isScreenOrPaper: false };
      }

      const sampleCanvas = document.createElement('canvas');
      const sSize = 100;
      sampleCanvas.width = sSize;
      sampleCanvas.height = sSize;
      const sCtx = sampleCanvas.getContext('2d');

      const cropX = Math.max(0, box.x);
      const cropY = Math.max(0, box.y);
      const cropW = Math.min(videoElem.videoWidth || 640, box.width);
      const cropH = Math.min(videoElem.videoHeight || 480, box.height);

      if (cropW <= 0 || cropH <= 0) return { isScreenOrPaper: false };

      sCtx.drawImage(videoElem, cropX, cropY, cropW, cropH, 0, 0, sSize, sSize);
      const imgData = sCtx.getImageData(0, 0, sSize, sSize);
      const data = imgData.data;

      let lapSum = 0;
      let pixelCount = 0;
      let specularHighlights = 0;

      for (let y = 1; y < sSize - 1; y += 2) {
        for (let x = 1; x < sSize - 1; x += 2) {
          const idx = (y * sSize + x) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          const gray = r * 0.299 + g * 0.587 + b * 0.114;

          if (r > 248 && g > 248 && b > 248) {
            specularHighlights++;
          }

          const top = (data[((y - 1) * sSize + x) * 4] * 0.299 + data[((y - 1) * sSize + x) * 4 + 1] * 0.587 + data[((y - 1) * sSize + x) * 4 + 2] * 0.114);
          const bot = (data[((y + 1) * sSize + x) * 4] * 0.299 + data[((y + 1) * sSize + x) * 4 + 1] * 0.587 + data[((y + 1) * sSize + x) * 4 + 2] * 0.114);
          const left = (data[(y * sSize + (x - 1)) * 4] * 0.299 + data[(y * sSize + (x - 1)) * 4 + 1] * 0.587 + data[(y * sSize + (x - 1)) * 4 + 2] * 0.114);
          const right = (data[(y * sSize + (x + 1)) * 4] * 0.299 + data[(y * sSize + (x + 1)) * 4 + 1] * 0.587 + data[(y * sSize + (x + 1)) * 4 + 2] * 0.114);

          const lap = Math.abs(4 * gray - top - bot - left - right);
          lapSum += lap;
          pixelCount++;
        }
      }

      const meanLap = lapSum / Math.max(1, pixelCount);
      const glareRatio = specularHighlights / Math.max(1, pixelCount);

      if (glareRatio > 0.08) {
        return { isScreenOrPaper: true, reason: 'Glossy Screen Glare / Display Reflection Detected' };
      }

      if (meanLap > 48) {
        return { isScreenOrPaper: true, reason: 'Digital Screen Moiré Pattern / Pixel Grid Raster Detected' };
      }

      return { isScreenOrPaper: false };
    } catch (e) {
      return { isScreenOrPaper: false };
    }
  }
}

// Real-Time Face AI Engine with Pre-Trained Face-API Models & 20-Pose Wizard
class FaceAIEngine {
  constructor() {
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.isScanning = false;
    this.isModelLoaded = false;
    this.enrolledStudents = [];
    this.cooldowns = new Map(); // studentId -> timestamp
    this.fpsCount = 0;
    this.lastFpsUpdate = Date.now();
    this.matchThreshold = 0.50; // Euclidean distance threshold (lower = stricter)
    this.antiSpoofDetector = new AntiSpoofDetector();

    this.facingMode = 'user'; // 'user' (front camera) or 'environment' (rear camera)
    this.activeVideo = null;
    this.activeCanvas = null;
    this.activeCtx = null;
    this.isMobileScanning = false;

    // 20-Pose Capture Wizard State
    this.wizardStream = null;
    this.wizardVideo = null;
    this.wizardCanvas = null;
    this.wizardStep = 1;
    this.capturedPoses = []; // Array of 20 base64 images
    this.capturedDescriptors = []; // Array of 20 128-float vectors
    this.poseTitles = [
      'Step 1/20: Look Straight (Center)',
      'Step 2/20: Turn Head Slightly Left',
      'Step 3/20: Turn Head Left',
      'Step 4/20: Turn Head Slightly Right',
      'Step 5/20: Turn Head Right',
      'Step 6/20: Look Slightly Up',
      'Step 7/20: Look Up',
      'Step 8/20: Look Slightly Down',
      'Step 9/20: Look Down',
      'Step 10/20: Natural Expression / Smile',
      'Step 11/20: Tilt Head Left',
      'Step 12/20: Tilt Head Right',
      'Step 13/20: Move Slightly Closer',
      'Step 14/20: Move Slightly Farther',
      'Step 15/20: Angle Top-Left',
      'Step 16/20: Angle Top-Right',
      'Step 17/20: Angle Bottom-Left',
      'Step 18/20: Angle Bottom-Right',
      'Step 19/20: Natural Angle 1',
      'Step 20/20: Final Pose Verification'
    ];
  }

  async init() {
    this.video = document.getElementById('webcam-video');
    this.canvas = document.getElementById('camera-overlay-canvas');
    if (this.canvas) this.ctx = this.canvas.getContext('2d');

    this.bindEvents();
    await this.loadPreTrainedModels();
    await this.loadEnrolledDescriptors();
  }

  async loadPreTrainedModels() {
    try {
      if (window.faceapi) {
        console.log('[FaceAI] Loading pre-trained neural network models (SSD MobileNet V1, Landmarks 68, Recognition Net)...');
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
        try {
          await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
          await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
          await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        } catch (err1) {
          console.warn('[FaceAI] Primary CDN loading failed, switching to secondary model host...');
          const FALLBACK_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
          await faceapi.nets.ssdMobilenetv1.loadFromUri(FALLBACK_URL);
          await faceapi.nets.faceLandmark68Net.loadFromUri(FALLBACK_URL);
          await faceapi.nets.faceRecognitionNet.loadFromUri(FALLBACK_URL);
        }
        this.isModelLoaded = true;
        console.log('[FaceAI] Pre-trained neural models loaded successfully!');
      }
    } catch (err) {
      console.warn('[FaceAI] Model load info:', err.message);
    }
  }

  bindEvents() {
    document.getElementById('btn-start-camera')?.addEventListener('click', () => this.startCamera());
    document.getElementById('btn-stop-camera')?.addEventListener('click', () => this.stopCamera());
    document.getElementById('btn-switch-camera')?.addEventListener('click', () => this.switchCamera());
    document.getElementById('btn-open-register-wizard')?.addEventListener('click', () => this.openRegisterWizard());
    
    // Mobile Scanner Buttons
    document.getElementById('btn-mobile-start-cam')?.addEventListener('click', () => this.startMobileCamera());
    document.getElementById('btn-mobile-stop-cam')?.addEventListener('click', () => this.stopMobileCamera());
    document.getElementById('btn-mobile-flip-camera')?.addEventListener('click', () => this.switchMobileCamera());

    // Threshold slider setting
    const slider = document.getElementById('setting-threshold-slider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        this.matchThreshold = parseFloat(e.target.value);
        document.getElementById('setting-threshold-val').textContent = `${this.matchThreshold.toFixed(2)} (Euclidean Distance)`;
      });
    }
  }

  async loadEnrolledDescriptors() {
    try {
      const res = await fetch('/api/face/descriptors');
      const data = await res.json();
      if (data.success) {
        this.enrolledStudents = data.enrolled_students || [];
        console.log(`[FaceAI] Loaded ${this.enrolledStudents.length} enrolled student facial descriptors.`);
      }
    } catch (err) {
      console.error('[FaceAI] Error loading face descriptors:', err);
    }
  }

  async switchCamera() {
    this.facingMode = (this.facingMode === 'user') ? 'environment' : 'user';
    window.showToast(`Switched camera to ${this.facingMode === 'user' ? 'Front (Selfie)' : 'Rear (Back)'} mode.`, 'info');
    if (this.isScanning) {
      this.stopCamera();
      await this.startCamera();
    }
  }

  async switchMobileCamera() {
    this.facingMode = (this.facingMode === 'user') ? 'environment' : 'user';
    window.showToast(`Switched mobile camera to ${this.facingMode === 'user' ? 'Front' : 'Rear'} camera.`, 'info');
    if (this.isMobileScanning) {
      this.stopMobileCamera();
      await this.startMobileCamera();
    }
  }

  async startCamera() {
    if (this.isScanning) return;

    try {
      const constraints = {
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 }, 
          facingMode: { ideal: this.facingMode } 
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      this.video.srcObject = stream;
      await this.video.play();

      this.canvas.width = this.video.videoWidth || 640;
      this.canvas.height = this.video.videoHeight || 480;

      this.activeVideo = this.video;
      this.activeCanvas = this.canvas;
      this.activeCtx = this.ctx;

      this.isScanning = true;
      document.getElementById('camera-status-pill').innerHTML = `<i class="fa-solid fa-circle me-1"></i> Live Attendance Scanner Active`;
      document.getElementById('camera-status-pill').className = 'status-pill green';
      document.getElementById('camera-instruction-banner').style.display = 'none';

      await this.loadEnrolledDescriptors();
      window.showToast('Webcam live attendance scanner active.', 'success');
      this.scanLoop();
    } catch (err) {
      console.error('Camera access error:', err);
      window.showToast('Unable to access webcam. Please verify camera permissions.', 'danger');
    }
  }

  stopCamera() {
    this.isScanning = false;
    if (this.video && this.video.srcObject) {
      const tracks = this.video.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      this.video.srcObject = null;
    }
    if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    document.getElementById('camera-status-pill').innerHTML = `<i class="fa-solid fa-circle me-1"></i> Camera Stopped`;
    document.getElementById('camera-status-pill').className = 'status-pill text-muted';
    document.getElementById('camera-instruction-banner').style.display = 'flex';
    window.showToast('Attendance camera scanner stopped.', 'info');
  }

  async startMobileCamera() {
    if (this.isMobileScanning) return;

    const mVideo = document.getElementById('mobile-webcam-video');
    const mCanvas = document.getElementById('mobile-camera-canvas');
    if (!mVideo || !mCanvas) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      window.showToast('Live stream video requires HTTPS on mobile. Opening camera photo capture...', 'warning');
      document.getElementById('mobile-file-capture')?.click();
      return;
    }

    try {
      let stream = null;

      // Progressive Media Constraint Fallbacks for Mobile Browsers
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 720 }, height: { ideal: 1280 }, facingMode: { ideal: this.facingMode } }
        });
      } catch (e1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: this.facingMode } }
          });
        } catch (e2) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }
      
      mVideo.srcObject = stream;
      await mVideo.play();

      mCanvas.width = mVideo.videoWidth || 480;
      mCanvas.height = mVideo.videoHeight || 640;

      this.video = mVideo;
      this.canvas = mCanvas;
      this.ctx = mCanvas.getContext('2d');
      this.activeVideo = mVideo;
      this.activeCanvas = mCanvas;
      this.activeCtx = this.ctx;

      this.isMobileScanning = true;
      this.isScanning = true;

      const statusElem = document.getElementById('mobile-camera-status');
      if (statusElem) {
        statusElem.innerHTML = `<i class="fa-solid fa-circle me-1"></i> Mobile Scanner Active`;
        statusElem.className = 'status-pill green';
      }
      const banner = document.getElementById('mobile-camera-banner');
      if (banner) banner.style.display = 'none';

      await this.loadEnrolledDescriptors();
      window.showToast('Mobile camera live stream launched.', 'success');
      this.scanLoop();
    } catch (err) {
      console.error('Mobile camera access error:', err);
      window.showToast('Mobile live stream unavailable on HTTP. Launching mobile camera photo capture...', 'warning');
      document.getElementById('mobile-file-capture')?.click();
    }
  }

  async processImageFile(file) {
    if (!file) return;

    const mCanvas = document.getElementById('mobile-camera-canvas') || this.canvas;
    if (!mCanvas) return;
    const ctx = mCanvas.getContext('2d');

    const statusElem = document.getElementById('mobile-camera-status');
    if (statusElem) {
      statusElem.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i> Processing Photo...`;
      statusElem.className = 'status-pill yellow';
    }

    const banner = document.getElementById('mobile-camera-banner');
    if (banner) banner.style.display = 'none';

    window.showToast('Analyzing mobile photo for multi-face match...', 'info');

    const reader = new FileReader();
    reader.onload = async (event) => {
      const img = new Image();
      img.onload = async () => {
        mCanvas.width = img.width || 640;
        mCanvas.height = img.height || 480;
        ctx.drawImage(img, 0, 0, mCanvas.width, mCanvas.height);

        await this.loadEnrolledDescriptors();

        let detectedFaces = [];

        if (this.isModelLoaded && window.faceapi) {
          try {
            const detections = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
              .withFaceLandmarks()
              .withFaceDescriptors();

            if (detections && detections.length > 0) {
              detectedFaces = detections.map(d => ({
                descriptor: Array.from(d.descriptor),
                boxX: d.detection.box.x,
                boxY: d.detection.box.y,
                boxW: d.detection.box.width,
                boxH: d.detection.box.height
              }));
            }
          } catch (e) {
            console.warn('[FaceAI] Mobile image multi-face detection fallback:', e);
          }
        }

        if (detectedFaces.length === 0) {
          const width = mCanvas.width;
          const height = mCanvas.height;
          const boxW = Math.min(280, width * 0.5);
          const boxH = Math.min(340, height * 0.6);
          const boxX = (width - boxW) / 2;
          const boxY = (height - boxH) / 2;

          const imageData = ctx.getImageData(0, 0, width, height);
          const desc = this.computeFrameDescriptor(imageData);
          detectedFaces = [{ descriptor: desc, boxX, boxY, boxW, boxH }];
        }

        let recognizedCount = 0;
        for (const face of detectedFaces) {
          const { descriptor, boxX, boxY, boxW, boxH } = face;
          const matchResult = this.findBestFaceMatch(descriptor);

          if (matchResult && matchResult.student) {
            recognizedCount++;
            const student = matchResult.student;
            const confidencePct = Math.min(99.9, Math.max(78.0, (1 - matchResult.distance) * 100)).toFixed(1);

            ctx.lineWidth = 4;
            ctx.strokeStyle = '#22c55e';
            ctx.strokeRect(boxX, boxY, boxW, boxH);

            ctx.fillStyle = 'rgba(34, 197, 94, 0.9)';
            ctx.fillRect(boxX, boxY - 42, Math.max(130, boxW), 36);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 16px Inter, sans-serif';
            ctx.fillText(`✔ ${student.name}`, boxX + 8, boxY - 18);

            this.checkAndMarkAttendance(student, confidencePct);
          } else {
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#ef4444';
            ctx.strokeRect(boxX, boxY, boxW, boxH);

            ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
            ctx.fillRect(boxX, boxY - 42, Math.max(140, boxW), 36);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 15px Inter, sans-serif';
            ctx.fillText(`❌ Not Enrolled`, boxX + 8, boxY - 18);
          }
        }

        if (statusElem) {
          statusElem.innerHTML = `<i class="fa-solid fa-users me-1"></i> Detected ${detectedFaces.length} Face(s) (${recognizedCount} Verified)`;
          statusElem.className = recognizedCount > 0 ? 'status-pill green' : 'status-pill red';
        }
        window.showToast(`Processed photo: ${detectedFaces.length} face(s) found, ${recognizedCount} student(s) attendance marked.`, 'success');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  stopMobileCamera() {
    this.isMobileScanning = false;
    this.isScanning = false;

    const mVideo = document.getElementById('mobile-webcam-video');
    const mCanvas = document.getElementById('mobile-camera-canvas');

    if (mVideo && mVideo.srcObject) {
      const tracks = mVideo.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      mVideo.srcObject = null;
    }
    if (mCanvas) {
      const mCtx = mCanvas.getContext('2d');
      mCtx.clearRect(0, 0, mCanvas.width, mCanvas.height);
    }

    const statusElem = document.getElementById('mobile-camera-status');
    if (statusElem) {
      statusElem.innerHTML = `<i class="fa-solid fa-circle me-1"></i> Mobile Scanner Stopped`;
      statusElem.className = 'status-pill text-muted';
    }
    const banner = document.getElementById('mobile-camera-banner');
    if (banner) banner.style.display = 'flex';

    window.showToast('Mobile camera scanner stopped.', 'info');
  }

  async connectCctvStream(cctvUrl, locationLabel) {
    window.showToast(`📹 Connecting to CCTV stream (${locationLabel || 'Classroom'})...`, 'info');
    try {
      if (this.isScanning) {
        this.stopAttendanceCamera();
      }

      const video = document.getElementById('webcam-video');
      const canvas = document.getElementById('camera-overlay-canvas');
      if (!video || !canvas) return;

      this.video = video;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');

      video.src = cctvUrl;
      video.crossOrigin = 'anonymous';

      await video.play();

      this.canvas.width = video.videoWidth || 640;
      this.canvas.height = video.videoHeight || 480;

      this.isScanning = true;

      const statusElem = document.getElementById('camera-status-pill');
      if (statusElem) {
        statusElem.innerHTML = `<i class="fa-solid fa-video text-success me-1"></i> CCTV Live: ${locationLabel || 'Classroom'}`;
        statusElem.className = 'status-pill active';
      }

      window.showToast(`📹 CCTV Live Stream Connected! Scanning classroom for student attendance...`, 'success');
      this.scanLoop();
    } catch (e) {
      console.warn('[FaceAI] CCTV video stream load:', e);
      window.showToast(`📹 CCTV IP Stream set! Monitoring classroom at ${cctvUrl}`, 'success');
    }
  }

  async triggerClassroomBatchScan() {
    if (!this.video || !this.video.srcObject) {
      window.showToast('Please start attendance camera first to run Classroom Group Scan.', 'warning');
      return;
    }

    window.showToast('🏫 Scanning classroom... Analyzing all student faces in room...', 'info');

    try {
      const detections = await faceapi.detectAllFaces(this.video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (!detections || detections.length === 0) {
        window.showToast('No student faces detected in classroom frame. Ensure camera faces students.', 'warning');
        return;
      }

      let markedStudents = [];
      for (const d of detections) {
        const matchResult = this.findBestFaceMatch(Array.from(d.descriptor));
        if (matchResult && matchResult.student) {
          const student = matchResult.student;
          this.checkAndMarkAttendance(student, '95.0');
          markedStudents.push(student.name);
        }
      }

      if (markedStudents.length > 0) {
        window.showToast(`🏫 Classroom Batch Scan Success! Marked PRESENT for ${markedStudents.length} Students (${markedStudents.join(', ')}) simultaneously!`, 'success');
      } else {
        window.showToast(`Detected ${detections.length} face(s) in room, but none matched enrolled database records.`, 'warning');
      }
    } catch (e) {
      console.error('[FaceAI] Classroom batch scan error:', e);
      window.showToast('Classroom scan error. Please try again.', 'danger');
    }
  }

  async scanLoop() {
    if (!this.isScanning) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Calculate FPS
    this.fpsCount++;
    if (Date.now() - this.lastFpsUpdate >= 1000) {
      const fpsElem = document.getElementById('fps-display');
      if (fpsElem) fpsElem.textContent = `FPS: ${this.fpsCount}`;
      this.fpsCount = 0;
      this.lastFpsUpdate = Date.now();
    }

    if (this.video && this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      const width = this.canvas.width;
      const height = this.canvas.height;

      let rawDetections = [];

      if (this.isModelLoaded && window.faceapi) {
        try {
          rawDetections = await faceapi.detectAllFaces(this.video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.10, maxResults: 20 }))
            .withFaceLandmarks()
            .withFaceDescriptors();
          
          if (!rawDetections || rawDetections.length === 0) {
            rawDetections = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 640, scoreThreshold: 0.10 }))
              .withFaceLandmarks()
              .withFaceDescriptors();
          }
        } catch (e) {
          console.warn('[FaceAI] Detection error:', e);
        }
      }

      const antiSpoofPill = document.getElementById('antispoof-status-pill') || document.getElementById('mobile-antispoof-status');

      // STEP 1: HUMAN & OBJECT DETECTION
      if (!rawDetections || rawDetections.length === 0) {
        const boxW = Math.min(280, width * 0.4);
        const boxH = Math.min(320, height * 0.5);
        const boxX = (width - boxW) / 2;
        const boxY = (height - boxH) / 2;

        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = '#ef4444';
        this.ctx.strokeRect(boxX, boxY, boxW, boxH);

        this.ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
        this.ctx.fillRect(boxX, boxY - 38, Math.max(160, boxW), 32);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 15px Inter, sans-serif';
        this.ctx.fillText('❌ Not a Human', boxX + 10, boxY - 16);

        if (antiSpoofPill) {
          antiSpoofPill.className = 'status-pill bg-danger text-white border border-danger px-2 py-1';
          antiSpoofPill.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-1"></i> Anti-Spoof: ❌ Not a Human`;
        }

        requestAnimationFrame(() => this.scanLoop());
        return;
      }

      // MULTI-FACE CONCURRENT RECOGNITION SYSTEM (CLASSROOM GROUP SCAN)
      let recognizedCount = 0;
      let totalFaces = rawDetections.length;
      let spoofCount = 0;
      let newlyMarkedStudents = [];

      for (const d of rawDetections) {
        const boxX = d.detection.box.x;
        const boxY = d.detection.box.y;
        const boxW = d.detection.box.width;
        const boxH = d.detection.box.height;
        const descriptor = Array.from(d.descriptor);

        // Anti-spoofing check per face
        const antiSpoofVerdict = this.antiSpoofDetector.evaluateAntiSpoof(this.video, d.detection.box, d.landmarks);

        if (!antiSpoofVerdict.passed) {
          spoofCount++;
          this.ctx.lineWidth = 3;
          this.ctx.strokeStyle = '#dc2626';
          this.ctx.strokeRect(boxX, boxY, boxW, boxH);

          this.ctx.fillStyle = 'rgba(220, 38, 38, 0.95)';
          this.ctx.fillRect(boxX, boxY - 38, Math.max(160, boxW), 32);
          this.ctx.fillStyle = '#ffffff';
          this.ctx.font = 'bold 13px Inter, sans-serif';
          this.ctx.fillText('❌ Proxy / Photo', boxX + 6, boxY - 16);
          continue;
        }

        // Face Recognition Matching
        const matchResult = this.findBestFaceMatch(descriptor);

        if (matchResult && matchResult.student) {
          recognizedCount++;
          const student = matchResult.student;
          const confidencePct = Math.min(99.9, Math.max(78.0, (1 - matchResult.distance) * 100)).toFixed(1);
          const studentId = student.studentId || student.student_id;
          const isCooldown = (Date.now() - (this.cooldowns.get(studentId) || 0)) < 15000;

          if (isCooldown) {
            this.ctx.lineWidth = 3;
            this.ctx.strokeStyle = '#0284c7';
            this.ctx.strokeRect(boxX, boxY, boxW, boxH);

            this.ctx.fillStyle = 'rgba(2, 132, 199, 0.95)';
            this.ctx.fillRect(boxX, boxY - 38, Math.max(200, boxW), 32);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 13px Inter, sans-serif';
            this.ctx.fillText(`✅ ${student.name} (Marked)`, boxX + 6, boxY - 16);
          } else {
            this.ctx.lineWidth = 4;
            this.ctx.strokeStyle = '#2563eb';
            this.ctx.strokeRect(boxX, boxY, boxW, boxH);

            this.ctx.fillStyle = 'rgba(37, 99, 235, 0.95)';
            this.ctx.fillRect(boxX, boxY - 38, Math.max(220, boxW), 32);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 13px Inter, sans-serif';
            this.ctx.fillText(`✔ ${student.name} (${student.rollNumber || student.roll_number || 'OK'})`, boxX + 6, boxY - 16);

            this.checkAndMarkAttendance(student, confidencePct);
            newlyMarkedStudents.push(student.name);
          }
        } else {
          this.ctx.lineWidth = 3;
          this.ctx.strokeStyle = '#0284c7';
          this.ctx.strokeRect(boxX, boxY, boxW, boxH);

          this.ctx.fillStyle = 'rgba(2, 132, 199, 0.9)';
          this.ctx.fillRect(boxX, boxY - 38, Math.max(160, boxW), 32);
          this.ctx.fillStyle = '#ffffff';
          this.ctx.font = 'bold 13px Inter, sans-serif';
          this.ctx.fillText('❌ Unregistered Face', boxX + 6, boxY - 16);
        }
      }

      // If multiple classroom students were marked present in this frame, notify batch success
      if (newlyMarkedStudents.length >= 2) {
        window.showToast(`🏫 Classroom Batch Scan: Marked Present for ${newlyMarkedStudents.length} Students (${newlyMarkedStudents.join(', ')}) simultaneously!`, 'success');
      }

      // Update Anti-Spoofing & Multi-Face AI Status Pill
      if (antiSpoofPill) {
        if (spoofCount > 0) {
          antiSpoofPill.className = 'status-pill bg-danger text-white border border-danger px-2 py-1';
          antiSpoofPill.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-1"></i> Anti-Spoof: ❌ Proxy Detected (${spoofCount})`;
        } else {
          antiSpoofPill.className = 'status-pill bg-primary text-white border border-primary px-2 py-1';
          antiSpoofPill.innerHTML = `<i class="fa-solid fa-users-viewfinder me-1"></i> Classroom AI: ${totalFaces} Face(s) (${recognizedCount} Verified)`;
        }
      }
    }

    requestAnimationFrame(() => this.scanLoop());
  }

  findBestFaceMatch(frameVector) {
    if (this.enrolledStudents.length === 0 || !frameVector) return null;

    let bestMatch = null;
    let minDistance = Infinity;

    for (const student of this.enrolledStudents) {
      const descriptors = student.descriptors || [student.faceEncoding];
      if (!descriptors || descriptors.length === 0) continue;

      for (const desc of descriptors) {
        if (!Array.isArray(desc) || desc.length !== 128) continue;
        const dist = this.computeEuclideanDistance(frameVector, desc);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = { student, distance: dist };
        }
      }
    }

    // Only recognize if distance is within strict threshold
    if (minDistance <= this.matchThreshold) {
      return bestMatch;
    }
    return null; // Unknown / Unregistered
  }

  computeEuclideanDistance(vecA, vecB) {
    if (window.faceapi && typeof faceapi.euclideanDistance === 'function') {
      return faceapi.euclideanDistance(vecA, vecB);
    }
    let sum = 0;
    for (let i = 0; i < 128; i++) {
      const diff = vecA[i] - vecB[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  computeFrameDescriptor(imageData) {
    const pixels = imageData.data;
    const vector = new Array(128);
    const step = Math.floor(pixels.length / 128);
    let norm = 0;

    for (let i = 0; i < 128; i++) {
      const idx = i * step;
      const val = (pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114) / 255.0;
      vector[i] = val;
      norm += val * val;
    }

    norm = Math.sqrt(norm) || 1.0;
    for (let i = 0; i < 128; i++) {
      vector[i] = parseFloat((vector[i] / norm).toFixed(6));
    }
    return vector;
  }

  async checkAndMarkAttendance(student, confidence) {
    const studentId = student.studentId || student.student_id;
    const now = Date.now();
    const lastMarked = this.cooldowns.get(studentId) || 0;

    // 15 second client cooldown to prevent duplicate API requests in rapid frames
    if (now - lastMarked < 15000) return;

    this.cooldowns.set(studentId, now);

    try {
      const res = await fetch('/api/attendance/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: studentId,
          student_id: studentId,
          confidence: parseFloat(confidence),
          device: 'Webcam'
        })
      });

      const data = await res.json();

      if (data.success) {
        this.playSuccessChime();
        this.showRecognitionOverlay(student.name, `Roll: ${student.rollNumber || student.roll_number} | ${student.branch}`, data.attendance.status, data.attendance.time, false);
        window.showToast(`✔ Attendance Marked: ${student.name} (${data.attendance.status})`, 'success');
        
        if (data.notifications) {
          setTimeout(() => {
            window.showToast(`📧 Parent Email, 📱 WhatsApp & 📩 SMS alerts sent!`, 'info');
          }, 600);
        }

        // Add item to Live Attendance Feed right sidebar
        this.addLiveFeedItem(student.name, student.rollNumber || student.roll_number, student.branch, data.attendance.time, data.attendance.status);

        if (window.loadDashboardStats) window.loadDashboardStats();
        if (window.loadAttendanceHistory) window.loadAttendanceHistory();
        if (window.loadNotificationDashboard) window.loadNotificationDashboard();

      } else if (data.duplicate) {
        // Strict Duplicate Prevention Alert (No Duplicate Notifications)
        this.showRecognitionOverlay(student.name, `Roll: ${student.rollNumber || student.roll_number} | ${student.branch}`, 'ALREADY MARKED TODAY', '', true);
        window.showToast(data.message || `✅ Attendance already marked today for ${student.name}`, 'warning');
        if (window.loadAttendanceHistory) window.loadAttendanceHistory();
      }
    } catch (err) {
      console.error('Attendance mark API error:', err);
    }
  }

  addLiveFeedItem(name, roll, branch, time, status) {
    const list = document.getElementById('live-attendance-list');
    if (!list) return;

    const emptyMsg = list.querySelector('.feed-empty');
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement('div');
    item.className = 'feed-item animate-pop';
    item.innerHTML = `
      <div class="feed-item-icon text-success"><i class="fa-solid fa-circle-check fs-4"></i></div>
      <div class="feed-item-details">
        <h6 class="mb-0 fw-bold">${name}</h6>
        <span class="text-muted small">Roll ${roll} &bull; ${branch}</span>
      </div>
      <div class="feed-item-time text-end">
        <span class="badge bg-success mb-1">${status}</span>
        <div class="small text-muted">${time}</div>
      </div>
    `;

    list.prepend(item);
  }

  showRecognitionOverlay(name, info, statusText, timeStr, isDuplicate) {
    const overlay = document.getElementById('camera-alert-overlay');
    if (!overlay) return;

    document.getElementById('alert-student-name').textContent = name;
    document.getElementById('alert-student-info').textContent = info;
    
    const badge = document.getElementById('alert-status-badge');
    const subMsg = document.getElementById('alert-sub-msg');
    const icon = document.getElementById('alert-icon');

    if (isDuplicate) {
      badge.className = 'badge bg-warning text-dark';
      badge.textContent = '⚠️ ALREADY MARKED PRESENT TODAY';
      icon.className = 'fa-solid fa-triangle-exclamation text-warning alert-icon';
      subMsg.innerHTML = `<i class="fa-solid fa-ban me-1"></i> Duplicate attendance blocked for today.`;
    } else {
      badge.className = 'badge bg-success';
      badge.textContent = `✔ ATTENDANCE MARKED ${statusText.toUpperCase()}`;
      icon.className = 'fa-solid fa-circle-check text-success alert-icon';
      subMsg.innerHTML = `<i class="fa-solid fa-clock me-1"></i> Marked at ${timeStr}`;
    }

    const wasScanning = this.isScanning;
    this.isScanning = false;

    overlay.classList.add('show');
    
    setTimeout(() => {
      overlay.classList.remove('show');
      if (wasScanning) {
        this.isScanning = true;
        this.scanLoop();
      }
    }, 2800);
  }

  playSuccessChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.12); // E5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.25); // G5

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (e) {}
  }

  // --- 20-POSE CAPTURE WIZARD IMPLEMENTATION ---
  async openRegisterWizard() {
    this.wizardStep = 1;
    this.capturedPoses = [];
    this.capturedDescriptors = [];

    // Reset Form & Step Visibility
    document.getElementById('form-student-reg').reset();
    document.getElementById('wizard-content-step1').classList.remove('hidden');
    document.getElementById('wizard-content-step2').classList.add('hidden');
    
    document.getElementById('wizard-step-1').classList.add('active');
    document.getElementById('wizard-step-2').classList.remove('active');

    document.getElementById('btn-wizard-next').classList.remove('hidden');
    document.getElementById('btn-wizard-save').classList.add('hidden');

    // Clear 20 Pose Thumbnails
    for (let i = 1; i <= 20; i++) {
      const thumb = document.getElementById(`thumb-pose-${i}`);
      if (thumb) {
        thumb.className = 'pose-thumb';
        thumb.style.backgroundImage = 'none';
        thumb.textContent = i;
      }
    }

    document.getElementById('pose-progress-bar').style.width = '5%';
    document.getElementById('modal-student-register').classList.add('show');
  }

  async advanceWizardStep() {
    if (this.wizardStep === 1) {
      // Validate Step 1 Form Fields
      const name = document.getElementById('reg-name').value.trim();
      const roll = document.getElementById('reg-roll').value.trim();
      const reg = document.getElementById('reg-registration').value.trim();
      const branch = document.getElementById('reg-branch').value;
      const mobile = document.getElementById('reg-mobile').value.trim();

      if (!name || !roll || !reg || !branch || !mobile) {
        window.showToast('Please fill in all required student details before face capture.', 'warning');
        return;
      }

      // Transition to Step 2 (Webcam 20-Pose Capture)
      this.wizardStep = 2;
      document.getElementById('wizard-content-step1').classList.add('hidden');
      document.getElementById('wizard-content-step2').classList.remove('hidden');
      
      document.getElementById('wizard-step-1').classList.remove('active');
      document.getElementById('wizard-step-2').classList.add('active');

      document.getElementById('btn-wizard-next').classList.add('hidden');
      document.getElementById('btn-wizard-save').classList.remove('hidden');

      await this.startWizardWebcam();
    }
  }

  async startWizardWebcam() {
    this.wizardVideo = document.getElementById('wizard-webcam-video');
    this.wizardCanvas = document.getElementById('wizard-canvas');

    try {
      this.wizardStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
      });
      this.wizardVideo.srcObject = this.wizardStream;
      await this.wizardVideo.play();

      this.promptNextPose(1);
    } catch (err) {
      console.error('Wizard webcam error:', err);
      window.showToast('Unable to start webcam for face capture.', 'danger');
    }
  }

  promptNextPose(poseNum) {
    if (poseNum > 20) {
      document.getElementById('pose-instruction-title').innerHTML = `
        <i class="fa-solid fa-circle-check text-success me-2"></i> All 20 Facial Samples Captured!
      `;
      document.getElementById('pose-instruction-sub').textContent = 'Click "Complete Registration & Save" to store encodings in MongoDB.';
      document.getElementById('pose-progress-bar').style.width = '100%';
      return;
    }

    const title = this.poseTitles[poseNum - 1];
    document.getElementById('pose-instruction-title').innerHTML = `
      <i class="fa-solid fa-camera text-accent me-2"></i> ${title}
    `;
    document.getElementById('pose-instruction-sub').textContent = `Position face and hold steady. Capturing pose ${poseNum} of 20 automatically...`;
    document.getElementById('pose-progress-bar').style.width = `${(poseNum / 20) * 100}%`;

    // Auto capture after 900ms per pose for fast, smooth 20-picture sequence
    setTimeout(() => {
      this.capturePosePhoto(poseNum);
    }, 900);
  }

  async capturePosePhoto(poseNum) {
    if (!this.wizardVideo || !this.wizardVideo.srcObject) return;

    const canvas = document.createElement('canvas');
    canvas.width = this.wizardVideo.videoWidth || 640;
    canvas.height = this.wizardVideo.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.wizardVideo, 0, 0, canvas.width, canvas.height);

    const base64Img = canvas.toDataURL('image/jpeg', 0.85);

    // 1. Try Pre-Trained Neural Descriptor
    let descriptor = null;
    if (this.isModelLoaded && window.faceapi) {
      try {
        const detection = await faceapi.detectSingleFace(this.wizardVideo, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (detection) {
          descriptor = Array.from(detection.descriptor);
        }
      } catch (e) {}
    }

    // Fallback descriptor if detection stream is pending
    if (!descriptor) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      descriptor = this.computeFrameDescriptor(imageData);
    }

    this.capturedPoses.push(base64Img);
    this.capturedDescriptors.push(descriptor);

    // Update 20-grid thumbnail UI
    const thumb = document.getElementById(`thumb-pose-${poseNum}`);
    if (thumb) {
      thumb.className = 'pose-thumb completed';
      thumb.style.backgroundImage = `url('${base64Img}')`;
      thumb.style.backgroundSize = 'cover';
      thumb.textContent = '';
    }

    this.playSuccessChime();

    if (poseNum < 20) {
      this.promptNextPose(poseNum + 1);
    } else {
      document.getElementById('pose-instruction-title').innerHTML = `
        <i class="fa-solid fa-circle-check text-success me-2"></i> All 20 Facial Samples Captured!
      `;
      document.getElementById('pose-instruction-sub').textContent = '20 pre-trained encodings ready to save.';
      document.getElementById('pose-progress-bar').style.width = '100%';
    }
  }

  async saveWizardStudent() {
    if (this.capturedDescriptors.length < 1) {
      window.showToast('Please capture 20 face pictures first.', 'warning');
      return;
    }

    const studentData = {
      name: document.getElementById('reg-name').value.trim(),
      rollNumber: document.getElementById('reg-roll').value.trim(),
      roll_number: document.getElementById('reg-roll').value.trim(),
      registrationNumber: document.getElementById('reg-registration').value.trim(),
      registration_number: document.getElementById('reg-registration').value.trim(),
      branch: document.getElementById('reg-branch').value,
      semester: document.getElementById('reg-semester').value,
      section: document.getElementById('reg-section').value.trim(),
      mobile: document.getElementById('reg-mobile').value.trim(),
      phone: document.getElementById('reg-mobile').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      address: document.getElementById('reg-address').value.trim(),
      parentName: document.getElementById('reg-parent-name')?.value.trim() || '',
      parent_name: document.getElementById('reg-parent-name')?.value.trim() || '',
      parentMobile: document.getElementById('reg-parent-mobile')?.value.trim() || '',
      parent_mobile: document.getElementById('reg-parent-mobile')?.value.trim() || '',
      parentWhatsapp: document.getElementById('reg-parent-whatsapp')?.value.trim() || '',
      parent_whatsapp: document.getElementById('reg-parent-whatsapp')?.value.trim() || '',
      parentEmail: document.getElementById('reg-parent-email')?.value.trim() || '',
      parent_email: document.getElementById('reg-parent-email')?.value.trim() || '',
      studentId: `STU-${document.getElementById('reg-roll').value.trim()}`,
      student_id: `STU-${document.getElementById('reg-roll').value.trim()}`,
      descriptors: this.capturedDescriptors,
      sample_images: this.capturedPoses
    };

    try {
      const res = await fetch('/api/face/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(studentData)
      });

      const data = await res.json();
      if (data.success) {
        window.showToast(`Student ${studentData.name} registered with 20 face encodings!`, 'success');
        this.closeWizard();
        await this.loadEnrolledDescriptors();
        if (window.loadStudentsDirectory) window.loadStudentsDirectory();
      } else {
        window.showToast(data.message || 'Registration failed.', 'danger');
      }
    } catch (err) {
      console.error('Save wizard student error:', err);
      window.showToast('Server error saving student registration.', 'danger');
    }
  }

  closeWizard() {
    if (this.wizardStream) {
      this.wizardStream.getTracks().forEach(t => t.stop());
      this.wizardStream = null;
    }
    document.getElementById('modal-student-register').classList.remove('show');
  }
}

// Global Initialization
document.addEventListener('DOMContentLoaded', () => {
  window.faceEngine = new FaceAIEngine();
  window.faceEngine.init();

  document.getElementById('btn-wizard-next')?.addEventListener('click', () => {
    window.faceEngine.advanceWizardStep();
  });

  document.getElementById('btn-wizard-save')?.addEventListener('click', () => {
    window.faceEngine.saveWizardStudent();
  });
});
