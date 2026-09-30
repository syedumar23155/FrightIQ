export function VesselIllustration({
  length,
  geared,
  index,
}: {
  length: number;
  geared: boolean;
  index: number;
}) {
  const hullWidth = 160 + ((length - 180) / (292 - 180)) * 76;
  const bow = 40 + hullWidth;
  const holds = Math.max(4, Math.round(length / 40));
  const holdWidth = (hullWidth - 48) / holds;
  const craneCount = geared ? 2 : 0;

  return (
    <div className="h-[68px] w-full overflow-hidden border-b border-border/70">
      <svg
        viewBox="0 0 320 100"
        className="h-full w-full"
        role="img"
        aria-label={`${length} metre bulk carrier illustration`}
        preserveAspectRatio="xMidYMid slice"
      >
        
        <rect width="320" height="100" fill={`#dbe7f5`} />
        <path d="M0 44h320M0 51h320" stroke="#1a5fb4" strokeOpacity=".12" />
        <path d="M0 80c42-5 63 6 103 1s59-4 96 1 78 3 121-2v20H0Z" fill="#b9cfe8" />
        <path d={`M34 57H${bow}l-16 18H54Z`} fill={`#1a5fb4`} />
        <path d={`M43 55H${bow - 16}`} stroke="#ffffff" strokeWidth="2" />
        {Array.from({ length: holds }, (_, hold) => {
          const x = 54 + hold * holdWidth;
          return (
            <g key={hold}>
              <rect x={x} y="42" width={holdWidth - 3} height="12" rx="1" fill="#ffffff" />
              <path d={`M${x + 3} 45h${holdWidth - 10}`} stroke="#6b87ab" strokeWidth="1" />
            </g>
          );
        })}
        {Array.from({ length: craneCount }, (_, crane) => {
          const x = 84 + crane * 47;
          return (
            <g key={crane} fill="none" stroke="#10285a" strokeWidth="2">
              <path d={`M${x} 42V25l12 17m-12-17h13m-3 0v17`} />
              <path d={`M${x + 13} 25v7`} strokeWidth="1.3" />
            </g>
          );
        })}
        <path d={`M${bow - 31} 56V32h17v24m-17-17h17`} fill="#ffffff" />
        <rect x={bow - 27} y="36" width="5" height="5" fill="#10285a" />
        <rect x={bow - 18} y="36" width="5" height="5" fill="#10285a" />
        <path
          d="M25 80c25-4 35 4 57 0m31 3c24-4 37 3 61-1m24 0c34-4 49 3 79-1"
          fill="none"
          stroke="#1a5fb4"
          strokeOpacity=".55"
        />
      </svg>
    </div>
  );
}
