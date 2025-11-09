import { motion } from "motion/react";

interface ButtonProps {
    children: React.ReactNode
    onClick: () => void;
    variant?: 'solid' | 'glass';
    pushable?: boolean;
}

const classVariants = {
    solid: "p-2 px-4 bg-white text-black font-mono rounded-lg uppercase",
    glass: "p-2 px-4 bg-white/10 border border-white/20 font-mono rounded-lg uppercase"
}

export default function Button({ children, onClick, variant = 'solid', pushable = true }: ButtonProps) {
    return (
        <motion.button
        whileTap={{ scale: pushable ? 0.95 : 1 }}
        transition={{ duration: 0.1 }}
        className={classVariants[variant]}
        onClick={onClick}
        >
            {children}
        </motion.button>
    )
}
