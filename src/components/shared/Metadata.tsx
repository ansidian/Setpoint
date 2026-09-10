import type { ReactNode } from 'react';
import './metadata.css';

/** Unboxed peer facts that wrap independently without punctuation stranded on a new line. */
export default function Metadata({ items, className = '' }: { items: ReactNode[]; className?: string }) {
  return <span className={`sp-metadata ${className}`}>{items.filter(item => item !== null && item !== undefined && item !== false && item !== '').map((item, index) => <span className="sp-metadata-item" key={index}>{item}</span>)}</span>;
}
