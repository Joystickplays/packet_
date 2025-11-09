import { motion } from "motion/react"

interface ModeProps {
    hide: boolean,
    mode: 'transmit' | 'receive'
    setMode: React.Dispatch<React.SetStateAction<"transmit" | "receive">>
}

export default function Mode({ hide, mode, setMode }: ModeProps) {
    return (
        <motion.div
        animate={hide ? { opacity: 0, y: 50 } : {}}
        className={`fixed flex p-1 border border-white/10 rounded-full w-fit bottom-0 left-1/2 -translate-x-1/2 mb-8 ${hide && "pointer-events-none"}`}>
            <motion.button
            whileTap={{ scale: 0.9 }}
            transition={{ duration: 0.1 }}
            onClick={() => {setMode("transmit")}}
            className={`p-2 px-4 text-sm ${mode === "transmit" ? "text-black" : "text-white"} font-mono uppercase ${mode === "transmit" && "bg-white"} rounded-full`}>Transmit</motion.button>
            <motion.button
            whileTap={{ scale: 0.9 }}
            transition={{ duration: 0.1 }}
            onClick={() => {setMode("receive")}}
            className={`p-2 px-4 text-sm ${mode === "receive" ? "text-black" : "text-white"} font-mono uppercase ${mode === "receive" && "bg-white"} rounded-full`}>Receive</motion.button>
        </motion.div>
    )
}