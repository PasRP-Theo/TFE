import { useState } from 'react';
import surveillanceLogo from '../assets/surveillance-logo.svg';

type BrandLogoProps = {
  wrapperClassName: string;
  imageClassName: string;
  fallbackClassName: string;
  fallbackText?: string;
};

export default function BrandLogo({
  wrapperClassName,
  imageClassName,
  fallbackClassName,
  fallbackText = 'A',
}: BrandLogoProps) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={wrapperClassName} aria-hidden="true">
      {failed ? (
        <span className={fallbackClassName}>{fallbackText}</span>
      ) : (
        <img
          className={imageClassName}
          src={surveillanceLogo}
          alt=""
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}