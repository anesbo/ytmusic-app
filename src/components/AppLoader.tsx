import React, { useEffect, useState } from "react";

export type LoaderStyle = "snake" | "bars" | "orbit" | "pulse" | "dots" | "minimal";

export const LOADER_STYLE_OPTIONS: Array<{ id: LoaderStyle; label: string; desc: string }> = [
  { id: "snake", label: "Neon Snake", desc: "Smooth glowing arc chasing around a ring" },
  { id: "bars", label: "Equalizer Bars", desc: "Mini 4-bar audio wave bouncing in rhythm" },
  { id: "orbit", label: "Dual Orbit", desc: "Two luminous satellites orbiting a core" },
  { id: "pulse", label: "Sonar Pulse", desc: "Expanding concentric ripple rings" },
  { id: "dots", label: "Wave Dots", desc: "Three dots rising in a fluid wave" },
  { id: "minimal", label: "Studio Arc", desc: "Clean ultra-thin minimalist spinner" },
];

interface AppLoaderProps {
  size?: number;
  styleOverride?: LoaderStyle | string;
  color?: string;
  className?: string;
}

const getDocLoaderStyle = (): LoaderStyle => {
  const attr = document.documentElement.getAttribute("data-loader");
  if (
    attr === "snake" ||
    attr === "bars" ||
    attr === "orbit" ||
    attr === "pulse" ||
    attr === "dots" ||
    attr === "minimal"
  ) {
    return attr;
  }
  return "snake";
};

export const AppLoader: React.FC<AppLoaderProps> = ({
  size = 18,
  styleOverride,
  color,
  className = "",
}) => {
  const [docStyle, setDocStyle] = useState<LoaderStyle>(getDocLoaderStyle);

  useEffect(() => {
    if (styleOverride) return;
    const onChange = () => setDocStyle(getDocLoaderStyle());
    window.addEventListener("liquidytm-loader-change", onChange);
    return () => window.removeEventListener("liquidytm-loader-change", onChange);
  }, [styleOverride]);

  const activeStyle = (styleOverride || docStyle) as LoaderStyle;
  const inlineStyle: React.CSSProperties = {
    width: size,
    height: size,
    color: color || "currentColor",
  };

  if (activeStyle === "bars") {
    return (
      <span
        className={`app-loader app-loader-bars ${className}`}
        style={inlineStyle}
        aria-label="Loading"
      >
        <i />
        <i />
        <i />
        <i />
      </span>
    );
  }

  if (activeStyle === "dots") {
    return (
      <span
        className={`app-loader app-loader-dots ${className}`}
        style={inlineStyle}
        aria-label="Loading"
      >
        <i />
        <i />
        <i />
      </span>
    );
  }

  if (activeStyle === "pulse") {
    return (
      <span
        className={`app-loader app-loader-pulse ${className}`}
        style={inlineStyle}
        aria-label="Loading"
      >
        <i />
        <i />
      </span>
    );
  }

  if (activeStyle === "orbit") {
    return (
      <span
        className={`app-loader app-loader-orbit ${className}`}
        style={inlineStyle}
        aria-label="Loading"
      >
        <i className="orbit-core" />
        <i className="orbit-ring">
          <b />
          <b />
        </i>
      </span>
    );
  }

  if (activeStyle === "minimal") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className={`app-loader app-loader-minimal ${className}`}
        style={{ color: color || "currentColor", flexShrink: 0 }}
        aria-label="Loading"
      >
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
        <path
          d="M12 2.5A9.5 9.5 0 0 1 21.5 12"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  // Default: "snake" — glowing dynamic coiling arc
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      className={`app-loader app-loader-snake ${className}`}
      style={{ color: color || "currentColor", flexShrink: 0 }}
      aria-label="Loading"
    >
      <circle
        cx="14"
        cy="14"
        r="10.5"
        stroke="currentColor"
        strokeOpacity="0.14"
        strokeWidth="2.6"
      />
      <circle
        className="app-loader-snake-path"
        cx="14"
        cy="14"
        r="10.5"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </svg>
  );
};
