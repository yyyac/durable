export function BrandLogo({ size = 28, className }: { size?: number; className?: string }) {
  return <img src="/logo.svg" width={size} height={size} className={className} alt="" aria-hidden="true" />;
}
