import { useId } from 'react'

import { buildPetShellGeometry } from './pet-shell-geometry'
import type { ChatBubbleDockConfig } from './pet-shell-geometry'

interface ChatBubbleShellProps {
  width: number
  height: number
  dock?: ChatBubbleDockConfig
}

const platformFront = 'M981 940C1011 940 1033 927 1042 910C1049 896 1058 893 1074 898C1110 911 1162 916 1225 916C1316 916 1390 895 1390 868V904C1390 930 1305 948 1230 948C1160 948 1115 937 1080 937C1060 937 1040 940 1018 940Z'
const platformRim = 'M1090 831C1066 830 1047 848 1052 867C1055 881 1067 895.5 1074 898C1110 911 1162 916 1225 916C1316 916 1390 895 1390 868'
const lowerEdge = 'M974 940H1018C1040 940 1060 937 1080 937C1115 937 1160 948 1230 948C1305 948 1390 930 1390 904V868'

/** One continuous perimeter. The platform is part of its fill, never a second disk. */
export function ChatBubbleShell({ width, height, dock }: ChatBubbleShellProps) {
  const uid = `pet-shell-${useId().replace(/:/g, '')}`
  const g = buildPetShellGeometry({ width, height }, dock)
  const id = (name: string) => `${uid}-${name}`
  const url = (name: string) => `url(#${id(name)})`
  return (
    <svg className="chat-bubble-shell" width={g.canvasWidth} height={g.canvasHeight} viewBox={`0 0 ${g.canvasWidth} ${g.canvasHeight}`} aria-hidden="true">
      <defs>
        <path id={id('outline')} d={g.outline} />
        <clipPath id={id('clip')}><use href={`#${id('outline')}`} /></clipPath>
        <linearGradient id={id('fill')} x1="0" y1="0" x2=".7" y2="1"><stop stopColor="#fffdfa" /><stop offset=".55" stopColor="#fff8ee" /><stop offset="1" stopColor="#fff1dc" /></linearGradient>
        <linearGradient id={id('line')} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffb374" /><stop offset=".42" stopColor="#ffdcad" /><stop offset=".72" stopColor="#ffac68" /><stop offset="1" stopColor="#f2af75" /></linearGradient>
        <filter id={id('shadow')} x="-15%" y="-15%" width="140%" height="150%"><feDropShadow dx="0" dy={14 * g.scale} stdDeviation={14 * g.scale} floodColor="#ad6635" floodOpacity=".24" /><feDropShadow dx="0" dy={3 * g.scale} stdDeviation={3 * g.scale} floodColor="#ea9754" floodOpacity=".4" /></filter>
        <linearGradient id={id('front')} x1="0" x2="1"><stop stopColor="#fff2df" /><stop offset=".18" stopColor="#f3bb8f" /><stop offset=".42" stopColor="#ffdfbf" /><stop offset=".64" stopColor="#fff0d9" /><stop offset=".83" stopColor="#ffe1c0" /><stop offset="1" stopColor="#f7bd8b" /></linearGradient>
        <radialGradient id={id('top')}><stop stopColor="#ffdbb2" /><stop offset=".67" stopColor="#ffe1b8" /><stop offset="1" stopColor="#ffc392" /></radialGradient>
        <linearGradient id={id('fade')} x1="980" x2="1080" gradientUnits="userSpaceOnUse"><stop stopColor="white" /><stop offset="1" stopColor="black" /></linearGradient>
        <mask id={id('border-mask')} maskUnits="userSpaceOnUse" x="-10" y="-10" width={g.canvasWidth + 20} height={g.canvasHeight + 20}>
          <rect x="-10" y="-10" width={g.canvasWidth + 20} height={g.canvasHeight + 20} fill="white" />
          <g transform={g.dockTransform}><rect x="978" y="820" width="430" height="210" fill={url('fade')} /></g>
        </mask>
      </defs>
      <use href={`#${id('outline')}`} fill={url('fill')} stroke="#ffce9f" strokeWidth={7 * g.scale} filter={url('shadow')} />
      <g clipPath={url('clip')}>
        <g transform={g.dockTransform}>
          <ellipse cx="1220" cy="868" rx="170" ry="48" fill={url('top')} />
          <path d={platformFront} fill={url('front')} />
        </g>
      </g>
      <g fill="none" mask={url('border-mask')}>
        <use href={`#${id('outline')}`} stroke="#ffce9f" strokeWidth={10 * g.scale} />
        <use href={`#${id('outline')}`} stroke="#fffefa" strokeWidth={5.5 * g.scale} />
        <use href={`#${id('outline')}`} stroke={url('line')} strokeWidth={1.5 * g.scale} />
      </g>
      <g transform={g.dockTransform} fill="none" strokeLinecap="round">
        <path d={platformRim} stroke="#e6a260" strokeOpacity=".26" strokeWidth="7" />
        <path d={platformRim} stroke="#ffdf99" strokeWidth="4.7" />
        <path d={platformRim} stroke="#fffde9" strokeWidth="2.1" />
        <path d={lowerEdge} stroke="#f4a463" strokeWidth="5" />
        <path d={lowerEdge} stroke="#fff3ca" strokeWidth="2.2" />
      </g>
    </svg>
  )
}
