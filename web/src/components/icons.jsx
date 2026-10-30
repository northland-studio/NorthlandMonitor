/** 轻量内联 SVG 图标集（stroke 跟随 currentColor，16px 栅格） */
import React from 'react';

function Svg({ children, size = 16, className = '' }) {
    return (
        <svg
            className={`icon ${className}`}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

export function IconOverview(props) {
    return (
        <Svg {...props}>
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </Svg>
    );
}

export function IconAlert(props) {
    return (
        <Svg {...props}>
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
        </Svg>
    );
}

export function IconAddNode(props) {
    return (
        <Svg {...props}>
            <rect x="2.5" y="4" width="19" height="6" rx="2" />
            <rect x="2.5" y="14" width="19" height="6" rx="2" />
            <path d="M6.5 7h.01M6.5 17h.01" />
            <path d="M12 10.5v3" />
        </Svg>
    );
}

export function IconSettings(props) {
    return (
        <Svg {...props}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </Svg>
    );
}

export function IconLogout(props) {
    return (
        <Svg {...props}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="m16 17 5-5-5-5" />
            <path d="M21 12H9" />
        </Svg>
    );
}

export function IconSun(props) {
    return (
        <Svg {...props}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </Svg>
    );
}

export function IconMoon(props) {
    return (
        <Svg {...props}>
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </Svg>
    );
}

export function IconRefresh(props) {
    return (
        <Svg {...props}>
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <path d="M21 3v6h-6" />
        </Svg>
    );
}

export function IconSearch(props) {
    return (
        <Svg {...props}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
        </Svg>
    );
}

export function IconCpu(props) {
    return (
        <Svg {...props}>
            <rect x="7" y="7" width="10" height="10" rx="2" />
            <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </Svg>
    );
}

export function IconFolder(props) {
    return (
        <Svg {...props}>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </Svg>
    );
}

export function IconFolderOpen(props) {
    return (
        <Svg {...props}>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" />
            <path d="M3 9h17.2a1.4 1.4 0 0 1 1.35 1.8l-1.6 7A2 2 0 0 1 18 19.5H5a2 2 0 0 1-2-2Z" />
        </Svg>
    );
}

export function IconFile(props) {
    return (
        <Svg {...props}>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
            <path d="M14 3v5h5" />
        </Svg>
    );
}

export function IconFileText(props) {
    return (
        <Svg {...props}>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
            <path d="M14 3v5h5" />
            <path d="M9 13h6M9 17h4" />
        </Svg>
    );
}

export function IconLink(props) {
    return (
        <Svg {...props}>
            <path d="M10 13a5 5 0 0 0 7.5.5l1.5-1.5a5 5 0 0 0-7-7L10.5 6.5" />
            <path d="M14 11a5 5 0 0 0-7.5-.5L5 12a5 5 0 0 0 7 7l1.5-1.5" />
        </Svg>
    );
}

export function IconEye(props) {
    return (
        <Svg {...props}>
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
        </Svg>
    );
}

export function IconDownload(props) {
    return (
        <Svg {...props}>
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M4 21h16" />
        </Svg>
    );
}

export function IconArrowUp(props) {
    return (
        <Svg {...props}>
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
        </Svg>
    );
}

export function IconHome(props) {
    return (
        <Svg {...props}>
            <path d="m3 10.5 9-7.5 9 7.5" />
            <path d="M5 10v10h14V10" />
            <path d="M10 20v-6h4v6" />
        </Svg>
    );
}

export function IconChevronRight(props) {
    return (
        <Svg {...props}>
            <path d="m9 5 7 7-7 7" />
        </Svg>
    );
}

export function IconTerminal(props) {
    return (
        <Svg {...props}>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="m7 9 3 3-3 3" />
            <path d="M13 15h4" />
        </Svg>
    );
}