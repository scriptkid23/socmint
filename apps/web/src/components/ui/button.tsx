import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'ghost';

const base =
  'inline-flex items-center gap-2 px-6 py-3 font-mono text-sm uppercase tracking-widest ' +
  'transition-colors duration-100 focus-visible:outline focus-visible:outline-[3px] ' +
  'focus-visible:outline-foreground focus-visible:outline-offset-[3px] disabled:opacity-40';

const variants: Record<Variant, string> = {
  primary:
    'bg-foreground text-background hover:bg-background hover:text-foreground hover:outline hover:outline-[2px] hover:outline-foreground',
  outline:
    'bg-transparent text-foreground outline outline-[2px] outline-foreground hover:bg-foreground hover:text-background',
  ghost: 'bg-transparent text-foreground hover:underline',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(({ variant = 'primary', className = '', ...props }, ref) => (
  <button ref={ref} className={`${base} ${variants[variant]} ${className}`} {...props} />
));
Button.displayName = 'Button';
