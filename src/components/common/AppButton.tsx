import React from 'react';
import { Button, ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AppButtonProps extends ButtonProps {
    children: React.ReactNode;
}

export const AppButton: React.FC<AppButtonProps> = ({ 
    children, 
    className,
    variant = 'ghost',
    ...props 
}) => {
    return (
        <Button
            variant={variant}
            className={cn(
                'flex items-center justify-center transition-colors',
                className
            )}
            {...props}
        >
            {children}
        </Button>
    );
};
