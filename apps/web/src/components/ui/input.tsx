import { forwardRef, type InputHTMLAttributes } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={
        'w-full bg-background px-0 py-2 font-serif text-lg text-foreground ' +
        'border-0 border-b-2 border-foreground placeholder:italic placeholder:text-muted-foreground ' +
        'focus:border-b-4 focus:outline-none ' +
        className
      }
      {...props}
    />
  ),
);
Input.displayName = 'Input';
