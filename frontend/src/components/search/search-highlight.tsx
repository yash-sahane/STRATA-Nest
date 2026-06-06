'use client';

import * as React from 'react';

interface SearchHighlightProps {
  text: string;
  query: string;
  className?: string;
}

export function SearchHighlight({ text, query, className = '' }: SearchHighlightProps) {
  // Escape special regex characters
  const escapeRegex = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Split text into parts (matched and unmatched)
  // Hook must be called before any conditional returns
  const parts = React.useMemo(() => {
    if (!query || !text) return [text];

    const escapedQuery = escapeRegex(query.trim());
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return text.split(regex);
  }, [text, query]);

  // Early return after all hooks have been called
  if (!query || !text) {
    return <>{text}</>;
  }

  return (
    <>
      {parts.map((part, index) => {
        const isMatch = part.toLowerCase() === query.toLowerCase();
        return (
          <React.Fragment key={index}>
            {isMatch ? (
              <mark className={`bg-yellow-200 dark:bg-yellow-900/50 font-medium rounded px-0.5 ${className}`}>
                {part}
              </mark>
            ) : (
              part
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

// Alternative component that uses HTML string (for more complex highlighting)
interface SearchHighlightHTMLProps {
  text: string;
  query: string;
  className?: string;
}

export function SearchHighlightHTML({
  text,
  query,
  className = '',
}: SearchHighlightHTMLProps) {
  const highlightedHTML = React.useMemo(() => {
    if (!query || !text) return text;

    const escapeRegex = (str: string) => {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const escapedQuery = escapeRegex(query.trim());
    const regex = new RegExp(`(${escapedQuery})`, 'gi');

    return text.replace(
      regex,
      '<mark class="bg-yellow-200 dark:bg-yellow-900/50 font-medium rounded px-0.5">$1</mark>'
    );
  }, [text, query]);

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: highlightedHTML }}
    />
  );
}
