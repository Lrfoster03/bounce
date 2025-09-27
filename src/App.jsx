import "./App.css";

import * as faceapi from "face-api.js";

import { useEffect, useRef, useState } from "react";

// Use your GitHub avatar instead of the SVG
const defaultAvatar = "https://avatars.githubusercontent.com/Lrfoster03";

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Store bouncing heads here
  const headsRef = useRef([]);
  const [defaultAvatarLoaded, setDefaultAvatarLoaded] = useState(false);

  // Load default avatar image
  useEffect(() => {
    const loadDefaultAvatar = async () => {
      try {
        const avatarDataUrl = await createCircularAvatar(defaultAvatar);
        // Create a fallback head with the loaded avatar
        const fallbackHead = spawnHead(
          avatarDataUrl,
          window.innerWidth / 2,
          window.innerHeight / 2
        );

        // Wait for the image to actually load
        fallbackHead.img.onload = () => {
          setDefaultAvatarLoaded(true);
        };

        headsRef.current = [fallbackHead];
      } catch (error) {
        console.error("Failed to load default avatar:", error);
        // Create a simple fallback
        const simpleFallback = createSimpleFallback();
        headsRef.current = [
          spawnHead(
            simpleFallback,
            window.innerWidth / 2,
            window.innerHeight / 2
          ),
        ];
        setDefaultAvatarLoaded(true);
      }
    };

    loadDefaultAvatar();
  }, []);

  // Load models + camera
  useEffect(() => {
    async function setup() {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri("./models");
        await faceapi.nets.faceLandmark68Net.loadFromUri("./models");

        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        console.warn("Camera denied or error:", err);
        // Fallback is already handled in the avatar loading effect
      }
    }
    setup();
  }, []);

  // Face detection loop
  useEffect(() => {
    let interval;

    async function detect() {
      if (!videoRef.current || videoRef.current.readyState !== 4) return;

      try {
        const detections = await faceapi
          .detectAllFaces(
            videoRef.current,
            new faceapi.TinyFaceDetectorOptions({
              inputSize: 224,
              scoreThreshold: 0.3,
            })
          )
          .withFaceLandmarks();

        // Check if detections exist and is an array
        if (
          !detections ||
          !Array.isArray(detections) ||
          detections.length === 0
        ) {
          return; // Keep existing heads, don't update
        }

        const newImages = detections.map((detection) => {
          const { x, y, width, height } = detection.detection.box;
          const cx = x + width / 2;
          const cy = y + height / 2;

          const targetSize = 200;
          const scaleFactor = 2.0;

          const cropWidth = width * scaleFactor;
          const cropHeight = height * scaleFactor * 1.2;
          const cropX = cx - cropWidth / 2;
          const cropY = cy - cropHeight / 2;

          const canvas = document.createElement("canvas");
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext("2d");

          // Create circular mask
          ctx.beginPath();
          ctx.ellipse(
            targetSize / 2, // x
            targetSize / 2, // y
            targetSize / 2, // radiusX
            targetSize / 2, // radiusY
            0, // rotation
            0, // startAngle
            2 * Math.PI // endAngle
          );
          ctx.closePath();
          ctx.clip();

          ctx.drawImage(
            videoRef.current,
            cropX,
            cropY,
            cropWidth,
            cropHeight,
            0,
            0,
            targetSize,
            targetSize
          );

          return canvas.toDataURL();
        });

        // Update existing heads or create new ones
        newImages.forEach((src, i) => {
          if (headsRef.current[i]) {
            // Update existing head image
            const head = headsRef.current[i];
            head.img.src = src;
          } else {
            // Create new head
            headsRef.current[i] = spawnHead(src);
          }
        });

        // Remove extra heads if fewer faces detected
        if (newImages.length < headsRef.current.length) {
          headsRef.current = headsRef.current.slice(0, newImages.length);
        }
      } catch (error) {
        console.error("Error in face detection:", error);
      }
    }

    interval = setInterval(detect, 500);
    return () => clearInterval(interval);
  }, []);

  // Animation loop
  useEffect(() => {
    if (!defaultAvatarLoaded) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Safe forEach with proper checks
      if (headsRef.current && Array.isArray(headsRef.current)) {
        headsRef.current.forEach((head) => {
          if (!head || !head.img) return;

          const { x, y, dx, dy, size } = head;
          const img = head.img;

          // Check if image is loaded properly before drawing
          if (img.complete && img.naturalWidth > 0) {
            try {
              // Update rotation angle
              const speed = Math.sqrt(dx * dx + dy * dy);
              const direction = dx >= 0 ? 1 : -1;
              head.angle = (head.angle || 0) + direction * (speed * 0.001);

              // Draw with rotation
              ctx.save();
              ctx.translate(x + size / 2, y + size / 2);
              ctx.rotate(head.angle);
              ctx.drawImage(img, -size / 2, -size / 2, size, size);
              ctx.restore();
            } catch (error) {
              console.error("Error drawing image:", error);
              return;
            }
          }

          // Update position
          head.x += head.dx;
          head.y += head.dy;

          // Bounce on edges
          if (head.x <= 0 || head.x + size >= canvas.width) {
            head.dx *= -1;
            head.x = Math.max(0, Math.min(head.x, canvas.width - size));
          }
          if (head.y <= 0 || head.y + size >= canvas.height) {
            head.dy *= -1;
            head.y = Math.max(0, Math.min(head.y, canvas.height - size));
          }
        });
      }

      // Handle collisions between all pairs
      for (let i = 0; i < headsRef.current.length; i++) {
        for (let j = i + 1; j < headsRef.current.length; j++) {
          const h1 = headsRef.current[i];
          const h2 = headsRef.current[j];

          if (!h1 || !h2) continue;

          const dx = h2.x + h2.size / 2 - (h1.x + h1.size / 2);
          const dy = h2.y + h2.size / 2 - (h1.y + h1.size / 2);
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = h1.size / 2 + h2.size / 2;

          if (dist < minDist && dist > 0) {
            // normalize vector
            const nx = dx / dist;
            const ny = dy / dist;

            // relative velocity
            const dvx = h1.dx - h2.dx;
            const dvy = h1.dy - h2.dy;

            // impact speed along normal
            const impact = dvx * nx + dvy * ny;
            if (impact > 0) continue;

            // bounce velocities
            h1.dx -= impact * nx;
            h1.dy -= impact * ny;
            h2.dx += impact * nx;
            h2.dy += impact * ny;

            // push them apart
            const overlap = minDist - dist;
            h1.x -= (overlap / 2) * nx;
            h1.y -= (overlap / 2) * ny;
            h2.x += (overlap / 2) * nx;
            h2.y += (overlap / 2) * ny;
          }
        }
      }

      requestAnimationFrame(animate);
    }

    animate();
  }, [defaultAvatarLoaded]);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ display: "none" }}
      />
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        style={{ position: "absolute", top: 0, left: 0 }}
      />
    </>
  );
}

// Create circular avatar from URL
async function createCircularAvatar(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 200;
      const ctx = canvas.getContext("2d");

      // Create circular clip
      ctx.beginPath();
      ctx.arc(100, 100, 100, 0, Math.PI * 2);
      ctx.clip();

      // Draw image
      ctx.drawImage(img, 0, 0, 200, 200);

      resolve(canvas.toDataURL());
    };

    img.onerror = () => {
      reject(new Error(`Failed to load image: ${imageUrl}`));
    };

    img.src = imageUrl;
  });
}

// Create simple fallback avatar
function createSimpleFallback() {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");

  // Blue circle background
  ctx.fillStyle = "#4A90E2";
  ctx.beginPath();
  ctx.arc(100, 100, 100, 0, Math.PI * 2);
  ctx.fill();

  // White initials
  ctx.fillStyle = "white";
  ctx.font = "bold 60px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("LF", 100, 100);

  return canvas.toDataURL();
}

// Calculate velocity scale based on screen size (1920x1080 as baseline)
function getVelocityScale() {
  const baseWidth = 1920;
  const baseHeight = 1080;
  const currentWidth = window.innerWidth;
  const currentHeight = window.innerHeight;

  // Use average of width and height scaling factors
  const widthScale = currentWidth / baseWidth;
  const heightScale = currentHeight / baseHeight;
  const scale = (widthScale + heightScale) / 2;

  // Ensure minimum scale of 0.3 and maximum of 3 for reasonable bounds
  return Math.max(0.3, Math.min(3, scale));
}

// Utility: create a new bouncing head
function spawnHead(src, startX, startY) {
  const img = new Image();
  img.src = src;

  const velocityScale = getVelocityScale();
  const baseVelocity = 2; // Base velocity for 1920x1080

  return {
    img,
    x: startX ?? Math.random() * (window.innerWidth - 120),
    y: startY ?? Math.random() * (window.innerHeight - 120),
    dx:
      (Math.random() < 0.5 ? -1 : 1) *
      (baseVelocity + Math.random()) *
      velocityScale,
    dy:
      (Math.random() < 0.5 ? -1 : 1) *
      (baseVelocity + Math.random()) *
      velocityScale,
    size: 120,
    angle: 0,
  };
}

export default App;
