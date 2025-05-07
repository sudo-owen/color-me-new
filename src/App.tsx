import { useState, useRef, useEffect, useCallback } from "react";
import { parseGIF, decompressFrames } from "gifuct-js";
import "./App.css";

// Minimal dark mode colors
const colors = {
  background: "#121212",
  surface: "#1E1E1E",
  text: "#E1E1E1",
  accent: "#555555",
  border: "#333333",
  primary: "#BB86FC",
};

// Types for our GIF data
interface GifFrame {
  dims: {
    width: number;
    height: number;
    top: number;
    left: number;
  };
  delay: number;
  disposalType: number;
  patch: Uint8ClampedArray;
  pixels: number[];
  transparentIndex?: number;
  colorTable: [number, number, number][];
}

interface ColorCount {
  color: string;
  count: number;
  rgb: [number, number, number];
}

interface ColorMapping {
  originalColor: string;
  originalRgb: [number, number, number];
  newColor: string;
  newRgb: [number, number, number];
}

function App() {
  // State for file upload and GIF data
  const [frames, setFrames] = useState<GifFrame[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(3);
  const [showUnrolled, setShowUnrolled] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorCount[]>([]);

  // State for color remapping
  const [colorMappings, setColorMappings] = useState<ColorMapping[]>([]);
  const [selectedColor, setSelectedColor] = useState<ColorCount | null>(null);
  const [remappedFrames, setRemappedFrames] = useState<GifFrame[]>([]);

  // Refs for canvas elements
  const regularCanvasRef = useRef<HTMLCanvasElement>(null);
  const zoomedCanvasRef = useRef<HTMLCanvasElement>(null);
  const tempCanvasRef = useRef<HTMLCanvasElement>(null);

  // Refs for remapped canvas elements
  const remappedCanvasRef = useRef<HTMLCanvasElement>(null);
  const remappedZoomedCanvasRef = useRef<HTMLCanvasElement>(null);

  // Animation frame request ID for cleanup
  const animationRef = useRef<number | null>(null);

  // Handle file upload
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const selectedFile = event.target.files[0];
      if (selectedFile.type === "image/gif") {
        parseGifFile(selectedFile);
      } else {
        setError("Please upload a GIF file");
      }
    }
  };

  // Parse the GIF file using gifuct-js
  const parseGifFile = async (gifFile: File) => {
    setIsLoading(true);
    setError(null);

    try {
      const arrayBuffer = await gifFile.arrayBuffer();
      const gif = parseGIF(arrayBuffer);
      const parsedFrames = decompressFrames(gif, true);

      setFrames(parsedFrames);
      setCurrentFrameIndex(0);

      // Reset color mappings when loading a new GIF
      setColorMappings([]);
      setSelectedColor(null);

      // Initialize remapped frames with deep copies of original frames (no changes yet)
      // We need to create deep copies to avoid reference issues
      const initialRemappedFrames = parsedFrames.map((frame) => ({
        ...frame,
        colorTable: [...frame.colorTable],
        patch: new Uint8ClampedArray(frame.patch),
      }));
      setRemappedFrames(initialRemappedFrames);

      // Extract color palette
      extractColorPalette(parsedFrames);

      // Start animation if we have frames
      if (parsedFrames.length > 0) {
        setIsPlaying(true);
      }
    } catch (err) {
      setError("Failed to parse GIF file");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Extract color palette from all frames
  const extractColorPalette = (gifFrames: GifFrame[]) => {
    const colorMap = new Map<
      string,
      { count: number; rgb: [number, number, number] }
    >();

    gifFrames.forEach((frame) => {
      const { pixels, colorTable, transparentIndex } = frame;

      pixels.forEach((pixelIndex) => {
        // Skip transparent pixels
        if (pixelIndex === transparentIndex) return;

        const rgb = colorTable[pixelIndex];
        const colorKey = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

        if (colorMap.has(colorKey)) {
          const current = colorMap.get(colorKey)!;
          colorMap.set(colorKey, { count: current.count + 1, rgb });
        } else {
          colorMap.set(colorKey, { count: 1, rgb });
        }
      });
    });

    // Convert map to array and sort by count (descending)
    const sortedColors = Array.from(colorMap.entries())
      .map(([color, { count, rgb }]) => ({ color, count, rgb }))
      .sort((a, b) => b.count - a.count);

    setColorPalette(sortedColors);
  };

  // Render a frame to canvas
  const renderFrame = useCallback(
    (frameIndex: number) => {
      if (
        !frames.length ||
        !regularCanvasRef.current ||
        !zoomedCanvasRef.current ||
        !tempCanvasRef.current
      )
        return;

      // Render original frame
      const frame = frames[frameIndex];
      const { dims, patch } = frame;

      // Set up temp canvas for frame rendering
      const tempCanvas = tempCanvasRef.current;
      tempCanvas.width = dims.width;
      tempCanvas.height = dims.height;
      const tempCtx = tempCanvas.getContext("2d")!;

      // Create ImageData and set patch data
      const imageData = tempCtx.createImageData(dims.width, dims.height);
      imageData.data.set(patch);
      tempCtx.putImageData(imageData, 0, 0);

      // Render to regular size canvas
      const regularCanvas = regularCanvasRef.current;
      const regularCtx = regularCanvas.getContext("2d")!;

      // Always clear the canvas before drawing a new frame
      regularCtx.clearRect(0, 0, regularCanvas.width, regularCanvas.height);

      // Draw the frame at its position
      regularCtx.drawImage(tempCanvas, dims.left, dims.top);

      // Render to zoomed canvas with pixelated scaling
      const zoomedCanvas = zoomedCanvasRef.current;
      const zoomedCtx = zoomedCanvas.getContext("2d")!;

      // Clear zoomed canvas
      zoomedCtx.clearRect(0, 0, zoomedCanvas.width, zoomedCanvas.height);

      // Set pixelated scaling
      zoomedCtx.imageSmoothingEnabled = false;

      // Draw the zoomed frame
      zoomedCtx.drawImage(
        regularCanvas,
        0,
        0,
        regularCanvas.width,
        regularCanvas.height,
        0,
        0,
        zoomedCanvas.width,
        zoomedCanvas.height
      );

      // Render remapped frame if available
      if (
        remappedFrames.length > 0 &&
        remappedCanvasRef.current &&
        remappedZoomedCanvasRef.current
      ) {
        const remappedFrame = remappedFrames[frameIndex];

        // Reuse the temp canvas for remapped frame
        tempCanvas.width = dims.width;
        tempCanvas.height = dims.height;

        // Create ImageData for remapped frame
        const remappedImageData = tempCtx.createImageData(
          dims.width,
          dims.height
        );
        remappedImageData.data.set(remappedFrame.patch);
        tempCtx.putImageData(remappedImageData, 0, 0);

        // Render to remapped regular size canvas
        const remappedCanvas = remappedCanvasRef.current;
        const remappedCtx = remappedCanvas.getContext("2d")!;

        // Clear canvas
        remappedCtx.clearRect(
          0,
          0,
          remappedCanvas.width,
          remappedCanvas.height
        );

        // Draw the remapped frame
        remappedCtx.drawImage(tempCanvas, dims.left, dims.top);

        // Render to remapped zoomed canvas
        const remappedZoomedCanvas = remappedZoomedCanvasRef.current;
        const remappedZoomedCtx = remappedZoomedCanvas.getContext("2d")!;

        // Clear canvas
        remappedZoomedCtx.clearRect(
          0,
          0,
          remappedZoomedCanvas.width,
          remappedZoomedCanvas.height
        );

        // Set pixelated scaling
        remappedZoomedCtx.imageSmoothingEnabled = false;

        // Draw the zoomed remapped frame
        remappedZoomedCtx.drawImage(
          remappedCanvas,
          0,
          0,
          remappedCanvas.width,
          remappedCanvas.height,
          0,
          0,
          remappedZoomedCanvas.width,
          remappedZoomedCanvas.height
        );
      }
    },
    [frames, remappedFrames]
  );

  // Animation loop
  useEffect(() => {
    if (!frames.length || !isPlaying) return;

    let lastTimestamp = 0;
    let accumulatedTime = 0;

    const animate = (timestamp: number) => {
      if (!lastTimestamp) lastTimestamp = timestamp;

      const deltaTime = timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      accumulatedTime += deltaTime;

      const currentFrame = frames[currentFrameIndex];
      if (accumulatedTime >= currentFrame.delay) {
        accumulatedTime = 0;
        const nextFrameIndex = (currentFrameIndex + 1) % frames.length;
        setCurrentFrameIndex(nextFrameIndex);
        renderFrame(nextFrameIndex);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [frames, currentFrameIndex, isPlaying, renderFrame]);

  // Initialize canvas sizes when frames are loaded
  useEffect(() => {
    if (!frames.length || !regularCanvasRef.current || !zoomedCanvasRef.current)
      return;

    // Find the dimensions of the GIF
    let width = 0;
    let height = 0;

    frames.forEach((frame) => {
      width = Math.max(width, frame.dims.left + frame.dims.width);
      height = Math.max(height, frame.dims.top + frame.dims.height);
    });

    // Set canvas sizes for original GIF
    const regularCanvas = regularCanvasRef.current;
    regularCanvas.width = width;
    regularCanvas.height = height;

    const zoomedCanvas = zoomedCanvasRef.current;
    zoomedCanvas.width = width * zoomLevel;
    zoomedCanvas.height = height * zoomLevel;

    // Set canvas sizes for remapped GIF if available
    if (remappedCanvasRef.current && remappedZoomedCanvasRef.current) {
      const remappedCanvas = remappedCanvasRef.current;
      remappedCanvas.width = width;
      remappedCanvas.height = height;

      const remappedZoomedCanvas = remappedZoomedCanvasRef.current;
      remappedZoomedCanvas.width = width * zoomLevel;
      remappedZoomedCanvas.height = height * zoomLevel;
    }

    // Render the first frame
    renderFrame(0);
  }, [
    frames,
    zoomLevel,
    renderFrame,
    remappedCanvasRef,
    remappedZoomedCanvasRef,
  ]);

  // Toggle play/pause
  const togglePlayPause = () => {
    setIsPlaying((prev) => !prev);
  };

  // Change zoom level
  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setZoomLevel(Number(e.target.value));
  };

  // Toggle unrolled frames view
  const toggleUnrolled = () => {
    setShowUnrolled((prev) => !prev);
  };

  // Function to convert RGB to HSL
  const rgbToHsl = (
    r: number,
    g: number,
    b: number
  ): [number, number, number] => {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0,
      s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }

      h /= 6;
    }

    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  };

  // Function to convert HEX to RGB
  const hexToRgb = (hex: string): [number, number, number] => {
    // Ensure the hex string has a # prefix
    const formattedHex = hex.startsWith("#") ? hex : `#${hex}`;

    // Handle both 3-digit and 6-digit hex formats
    let result;
    if (formattedHex.length === 4) {
      // For 3-digit hex (#RGB), convert to 6-digit format (#RRGGBB)
      result = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(formattedHex);
      return result
        ? [
            parseInt(result[1] + result[1], 16),
            parseInt(result[2] + result[2], 16),
            parseInt(result[3] + result[3], 16),
          ]
        : [0, 0, 0];
    } else {
      // For 6-digit hex (#RRGGBB)
      result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(formattedHex);
      return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
          ]
        : [0, 0, 0];
    }
  };

  // Function to handle color selection for remapping
  const handleColorSelect = (colorInfo: ColorCount) => {
    setSelectedColor(colorInfo);

    // Check if this color is already mapped
    const existingMapping = colorMappings.find(
      (mapping) => mapping.originalColor === colorInfo.color
    );

    if (!existingMapping) {
      // If no existing mapping, create a new one with the same color (no change yet)
      const newMapping: ColorMapping = {
        originalColor: colorInfo.color,
        originalRgb: colorInfo.rgb,
        newColor: colorInfo.color,
        newRgb: colorInfo.rgb,
      };
      setColorMappings([...colorMappings, newMapping]);
    }
  };

  // Function to validate and format a hex color
  const validateHexColor = (color: string): string | null => {
    // Check if it's a valid hex color
    const hexRegex = /^#?([a-f\d]{3}|[a-f\d]{6})$/i;
    if (!hexRegex.test(color)) {
      return null;
    }

    // Ensure it has a # prefix
    const formattedColor = color.startsWith("#") ? color : `#${color}`;

    // Convert 3-digit hex to 6-digit if needed
    if (formattedColor.length === 4) {
      const r = formattedColor[1];
      const g = formattedColor[2];
      const b = formattedColor[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }

    return formattedColor;
  };

  // Function to update a color mapping
  const updateColorMapping = (newColor: string) => {
    if (!selectedColor) return;

    // Validate and format the hex color
    const validatedColor = validateHexColor(newColor);
    if (!validatedColor) {
      // If invalid, don't update
      console.warn("Invalid hex color:", newColor);
      return;
    }

    const newRgb = hexToRgb(validatedColor);

    const updatedMappings = colorMappings.map((mapping) => {
      if (mapping.originalColor === selectedColor.color) {
        return {
          ...mapping,
          newColor: validatedColor,
          newRgb,
        };
      }
      return mapping;
    });

    setColorMappings(updatedMappings);

    // Apply the color mappings to create remapped frames
    if (frames.length > 0) {
      const newRemappedFrames = remapFramesColors(frames, updatedMappings);
      setRemappedFrames(newRemappedFrames);
    }
  };

  // Function to remove a specific color mapping
  const removeColorMapping = (originalColor: string) => {
    // Filter out the mapping with the specified original color
    const updatedMappings = colorMappings.filter(
      (mapping) => mapping.originalColor !== originalColor
    );

    setColorMappings(updatedMappings);

    // If the selected color was the one removed, deselect it
    if (selectedColor?.color === originalColor) {
      setSelectedColor(null);
    }

    // Apply the updated color mappings to create remapped frames
    if (frames.length > 0) {
      const newRemappedFrames = remapFramesColors(frames, updatedMappings);
      setRemappedFrames(newRemappedFrames);
    }
  };

  // Function to remap colors in frames
  const remapFramesColors = (
    originalFrames: GifFrame[],
    mappings: ColorMapping[]
  ): GifFrame[] => {
    if (mappings.length === 0) return [...originalFrames];

    return originalFrames.map((frame) => {
      // Create a new color table by applying mappings
      const newColorTable = [...frame.colorTable];

      // For each pixel, check if its color needs to be remapped
      frame.pixels.forEach((pixelIndex) => {
        // Skip transparent pixels
        if (pixelIndex === frame.transparentIndex) return;

        const originalRgb = frame.colorTable[pixelIndex];
        const originalColorKey = `rgb(${originalRgb[0]},${originalRgb[1]},${originalRgb[2]})`;

        // Find if this color has a mapping
        const mapping = mappings.find(
          (m) => m.originalColor === originalColorKey
        );

        if (mapping) {
          // Update the color table for this index
          newColorTable[pixelIndex] = mapping.newRgb;
        }
      });

      // Regenerate the patch data with the new color table
      const totalPixels = frame.pixels.length;
      const newPatch = new Uint8ClampedArray(totalPixels * 4);

      for (let i = 0; i < totalPixels; i++) {
        const pos = i * 4;
        const colorIndex = frame.pixels[i];
        const color = newColorTable[colorIndex] || [0, 0, 0];

        newPatch[pos] = color[0]; // R
        newPatch[pos + 1] = color[1]; // G
        newPatch[pos + 2] = color[2]; // B
        newPatch[pos + 3] = colorIndex !== frame.transparentIndex ? 255 : 0; // Alpha
      }

      // Create a new frame with the updated color table and patch
      return {
        ...frame,
        colorTable: newColorTable,
        patch: newPatch,
      };
    });
  };

  return (
    <div
      className="container px-4 py-4"
      style={{ color: colors.text, backgroundColor: colors.background }}
    >
      {/* Ultra-compact controls - true one-liner */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className="whitespace-nowrap">Upload GIF:</span>
        <input
          type="file"
          accept="image/gif"
          onChange={handleFileChange}
          className="py-0 h-7 text-xs flex-grow-0"
          style={{ backgroundColor: colors.surface, maxWidth: "10rem" }}
        />
        {frames.length > 0 && (
          <>
            <button
              onClick={togglePlayPause}
              className="px-2 py-0 h-7 text-xs whitespace-nowrap"
              style={{ backgroundColor: colors.surface, color: colors.text }}
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <span className="whitespace-nowrap">Zoom: {zoomLevel}x</span>
            <input
              type="range"
              min="1"
              max="10"
              value={zoomLevel}
              onChange={handleZoomChange}
              className="w-20 h-4"
            />
            <button
              onClick={toggleUnrolled}
              className="px-2 py-0 h-7 text-xs whitespace-nowrap"
              style={{ backgroundColor: colors.surface, color: colors.text }}
            >
              {showUnrolled ? "Hide" : "Show"}
            </button>
            <span className="text-xs whitespace-nowrap">
              Delay: {frames[currentFrameIndex]?.delay}ms
            </span>
          </>
        )}
        {error && <span className="text-red-500 text-xs">{error}</span>}
        {isLoading && <span className="text-xs">Loading...</span>}
      </div>

      {frames.length > 0 && (
        <>
          <div className="mb-6">
            <div className="flex justify-between gap-4">
              <div className="">
                <h2 className="text-lg mb-2">Original GIF</h2>
                <div className="mt-4">
                  <div className="overflow-auto">
                    <canvas
                      ref={regularCanvasRef}
                      className="border"
                      style={{
                        maxWidth: "100%",
                        height: "auto",
                        borderColor: colors.border,
                      }}
                    ></canvas>
                    <canvas
                      ref={zoomedCanvasRef}
                      className="border"
                      style={{
                        maxWidth: "100%",
                        height: "auto",
                        imageRendering: "pixelated",
                        borderColor: colors.border,
                      }}
                    ></canvas>
                  </div>
                </div>
              </div>

              <div className="">
                <h2 className="text-lg mb-2">Remapped GIF</h2>
                <div className="mt-4">
                  <div className="overflow-auto">
                    <canvas
                      ref={remappedCanvasRef}
                      className="border"
                      style={{
                        maxWidth: "100%",
                        height: "auto",
                        borderColor: colors.border,
                      }}
                    ></canvas>
                    <canvas
                      ref={remappedZoomedCanvasRef}
                      className="border"
                      style={{
                        maxWidth: "100%",
                        height: "auto",
                        imageRendering: "pixelated",
                        borderColor: colors.border,
                      }}
                    ></canvas>
                  </div>
                </div>
              </div>
            </div>

            {/* Color Remapping Controls */}
            <div className="flex flex-col h-full">
              <div className="flex flex-col md:flex-row gap-4">
                {/* Left column - Color palette */}
                <div className="md:w-3/5">
                  {/* Color Palette */}
                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-md font-medium">
                        Color Palette ({colorPalette.length} colors)
                      </h3>
                    </div>

                    <div className="flex flex-wrap gap-2 overflow-y-auto">
                      {colorPalette.map((colorInfo, index) => {
                        const isRemapped = colorMappings.some(
                          (mapping) =>
                            mapping.originalColor === colorInfo.color &&
                            mapping.newColor !== colorInfo.color
                        );

                        return (
                          <div
                            key={index}
                            className="flex flex-col items-center p-2 rounded cursor-pointer transition-all"
                            style={{
                              position: "relative",
                            }}
                            onClick={() => handleColorSelect(colorInfo)}
                          >
                            {isRemapped && (
                              <div
                                className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-green-500"
                                title="This color has been remapped"
                              ></div>
                            )}
                            <div
                              className=""
                              style={{
                                backgroundColor: colorInfo.color,
                                borderColor: colors.border,
                                width: "36px",
                                height: "36px",
                                margin: "2px",
                                borderRadius: "4px",
                              }}
                            ></div>
                            <div className="text-xs text-center"></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Right column - Selected color + active mappings */}
                <div className="md:w-2/5">
                  {/* Selected Color Section */}
                  <div
                    className="border p-3 mb-4 rounded"
                    style={{ borderColor: colors.border }}
                  >
                    {selectedColor ? (
                      <div className="flex flex-col">
                        {/* Color Picker - Improved layout */}
                        <div className="mb-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              className="w-12 h-8"
                              value={
                                colorMappings.find(
                                  (m) => m.originalColor === selectedColor.color
                                )?.newColor || selectedColor.color
                              }
                              onChange={(e) =>
                                updateColorMapping(e.target.value)
                              }
                            />
                            <input
                              type="text"
                              className="flex-1 px-2 py-1 text-sm font-mono rounded"
                              style={{
                                backgroundColor: colors.surface,
                                color: colors.text,
                              }}
                              value={
                                colorMappings.find(
                                  (m) => m.originalColor === selectedColor.color
                                )?.newColor || selectedColor.color
                              }
                              onChange={(e) =>
                                updateColorMapping(e.target.value)
                              }
                            />
                          </div>
                        </div>

                        {/* Preview - Enhanced with background */}
                        <div
                          className="flex items-center mb-3 p-2 rounded"
                          style={{ backgroundColor: colors.surface }}
                        >
                          <div className="flex-1 text-center">
                            <div className="text-xs mb-1">Original</div>
                            <div
                              className="mx-auto border rounded"
                              style={{
                                backgroundColor: selectedColor.color,
                                borderColor: colors.border,
                                width: "32px",
                                height: "32px",
                              }}
                            ></div>
                          </div>
                          <div className="text-xl mx-2">→</div>
                          <div className="flex-1 text-center">
                            <div className="text-xs mb-1">New</div>
                            <div
                              className="mx-auto border rounded"
                              style={{
                                backgroundColor:
                                  colorMappings.find(
                                    (m) =>
                                      m.originalColor === selectedColor.color
                                  )?.newColor || selectedColor.color,
                                borderColor: colors.border,
                                width: "32px",
                                height: "32px",
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* Reset button */}
                        {colorMappings.some(
                          (m) =>
                            m.originalColor === selectedColor.color &&
                            m.newColor !== selectedColor.color
                        ) && (
                          <button
                            className="text-xs px-2 py-1 mt-1 w-full rounded"
                            style={{
                              backgroundColor: colors.surface,
                              color: colors.text,
                            }}
                            onClick={() => {
                              // Reset this color mapping to the original color
                              updateColorMapping(selectedColor.color);
                            }}
                          >
                            Reset to Original Color
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm p-4 flex items-center justify-center h-24 text-center opacity-70">
                        Select a color from the palette to edit it
                      </div>
                    )}
                  </div>

                  {/* Color Mappings List */}
                  <div
                    className="border p-3 mb-4 rounded"
                    style={{ borderColor: colors.border }}
                  >
                    <div className="flex justify-between items-center mb-3">
                      {colorMappings.length > 0 && (
                        <button
                          className="text-xs px-2 py-1 rounded"
                          style={{
                            backgroundColor: colors.surface,
                            color: colors.text,
                          }}
                          onClick={() => {
                            // Reset all color mappings
                            setColorMappings([]);
                            // Reset remapped frames to original frames
                            const initialRemappedFrames = frames.map(
                              (frame) => ({
                                ...frame,
                                colorTable: [...frame.colorTable],
                                patch: new Uint8ClampedArray(frame.patch),
                              })
                            );
                            setRemappedFrames(initialRemappedFrames);
                          }}
                        >
                          Reset All
                        </button>
                      )}
                    </div>
                      <div className="flex flex-wrap gap-4 min-h-48">
                        {colorMappings.map((mapping, index) => (
                          <div
                            key={index}
                            className="flex items-center rounded relative"
                            style={{
                              backgroundColor: colors.surface,
                              padding: "1rem",
                            }}
                          >
                            <div
                              className="flex items-center cursor-pointer"
                              onClick={() => {
                                // Find the color in the palette that matches this mapping
                                const colorInfo = colorPalette.find(
                                  (color) =>
                                    color.color === mapping.originalColor
                                );
                                if (colorInfo) {
                                  handleColorSelect(colorInfo);
                                }
                              }}
                            >
                              <div
                                className="mr-1 border rounded"
                                style={{
                                  backgroundColor: mapping.originalColor,
                                  borderColor: colors.border,
                                  width: "20px",
                                  height: "20px",
                                  minWidth: "20px",
                                  minHeight: "20px",
                                }}
                              ></div>
                              <div className="text-lg mx-1">→</div>
                              <div
                                className="mr-2 border rounded"
                                style={{
                                  backgroundColor: mapping.newColor,
                                  borderColor: colors.border,
                                  width: "20px",
                                  height: "20px",
                                  minWidth: "20px",
                                  minHeight: "20px",
                                }}
                              ></div>
                            </div>

                            {/* X button to remove this color mapping */}
                            <button
                              className="w-5 h-5 justify-center rounded-full text-xs opacity-70 hover:opacity-100 cursor-pointer ml-4"
                              style={{
                                backgroundColor: colors.accent,
                                color: colors.text,
                              }}
                              onClick={(e) => {
                                e.stopPropagation(); // Prevent triggering the parent onClick
                                removeColorMapping(mapping.originalColor);
                              }}
                              title="Remove this color mapping"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Unrolled Frames Section - Full Width */}
          {showUnrolled && (
            <div className="mt-6">
              <h2 className="text-lg mb-2">All Frames</h2>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                {/* Original Frames */}
                <div>
                  <h3 className="text-md mb-2">Original Frames</h3>
                  <div className="flex flex-wrap gap-4">
                    {frames.map((frame, index) => (
                      <div
                        key={index}
                        className="relative"
                        onClick={() => setCurrentFrameIndex(index)}
                      >
                        <canvas
                          width={frame.dims.width * zoomLevel}
                          height={frame.dims.height * zoomLevel}
                          className="border cursor-pointer"
                          style={{
                            imageRendering: "pixelated",
                            borderColor:
                              currentFrameIndex === index
                                ? colors.text
                                : colors.border,
                            display: "block",
                          }}
                          ref={(canvas) => {
                            if (canvas) {
                              const ctx = canvas.getContext("2d")!;
                              ctx.imageSmoothingEnabled = false;

                              // Create temp canvas for the frame
                              const tempCanvas =
                                document.createElement("canvas");
                              tempCanvas.width = frame.dims.width;
                              tempCanvas.height = frame.dims.height;
                              const tempCtx = tempCanvas.getContext("2d")!;

                              // Draw the frame
                              const imageData = tempCtx.createImageData(
                                frame.dims.width,
                                frame.dims.height
                              );
                              imageData.data.set(frame.patch);
                              tempCtx.putImageData(imageData, 0, 0);

                              // Draw to the zoomed canvas
                              ctx.drawImage(
                                tempCanvas,
                                0,
                                0,
                                frame.dims.width,
                                frame.dims.height,
                                0,
                                0,
                                frame.dims.width * zoomLevel,
                                frame.dims.height * zoomLevel
                              );
                            }
                          }}
                        ></canvas>
                        <div className="absolute bottom-0 right-0 bg-black text-white text-xs px-1">
                          {index + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Remapped Frames */}
                {remappedFrames.length > 0 && (
                  <div>
                    <h3 className="text-md mb-2">Remapped Frames</h3>
                    <div className="flex flex-wrap gap-4">
                      {remappedFrames.map((frame, index) => (
                        <div
                          key={index}
                          className="relative"
                          onClick={() => setCurrentFrameIndex(index)}
                        >
                          <canvas
                            width={frame.dims.width * zoomLevel}
                            height={frame.dims.height * zoomLevel}
                            className="border cursor-pointer"
                            style={{
                              imageRendering: "pixelated",
                              borderColor:
                                currentFrameIndex === index
                                  ? colors.text
                                  : colors.border,
                              display: "block",
                            }}
                            ref={(canvas) => {
                              if (canvas) {
                                const ctx = canvas.getContext("2d")!;
                                ctx.imageSmoothingEnabled = false;

                                // Create temp canvas for the frame
                                const tempCanvas =
                                  document.createElement("canvas");
                                tempCanvas.width = frame.dims.width;
                                tempCanvas.height = frame.dims.height;
                                const tempCtx = tempCanvas.getContext("2d")!;

                                // Draw the frame
                                const imageData = tempCtx.createImageData(
                                  frame.dims.width,
                                  frame.dims.height
                                );
                                imageData.data.set(frame.patch);
                                tempCtx.putImageData(imageData, 0, 0);

                                // Draw to the zoomed canvas
                                ctx.drawImage(
                                  tempCanvas,
                                  0,
                                  0,
                                  frame.dims.width,
                                  frame.dims.height,
                                  0,
                                  0,
                                  frame.dims.width * zoomLevel,
                                  frame.dims.height * zoomLevel
                                );
                              }
                            }}
                          ></canvas>
                          <div className="absolute bottom-0 right-0 bg-black text-white text-xs px-1">
                            {index + 1}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Hidden temp canvas for rendering */}
      <canvas ref={tempCanvasRef} style={{ display: "none" }}></canvas>
    </div>
  );
}

export default App;
