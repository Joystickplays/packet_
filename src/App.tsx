import { useEffect, useRef, useState } from 'react'
import Header from './components/HeaderLogo'
import './App.css'
import QRCode from 'react-qr-code'
import { Check, Copy, File, Github, LoaderCircle, RotateCw, Send, Upload } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Peer from 'peerjs'
import { Scanner } from '@yudiel/react-qr-scanner'
import Mode from './components/ModeSwitcher'
import { toast } from 'sonner'
// import NumberFlow from '@number-flow/react'
import { formatBytes } from './utils/formatSize'
import Button from './components/Button'


type PingPongData = {
  ping: number;
  pong: number;
};

type TimeSyncData = {
  timeSync: { T1: number, T2: number };
  timeSyncResponse: { T1: number, T2: number };
  timeSyncResult: number;
};

type FileSignalData = {
  filePrepared: { name: string; bytes: number };
  fileCancelPrepare: true;

  filePeerSending: true;

  filePeerPacket: { partition: number };
  filePeerPacketBlob: ArrayBuffer;
  fileFinished: { name: string };
};

type SpeedTest = {
  speedAck: true;
  speedTest: number;

  speedResult: number;
}

type MessageData = {
  message: string
};

type CommandDataMap = PingPongData & TimeSyncData & FileSignalData & MessageData & SpeedTest;


type Command = {
  [K in keyof CommandDataMap]: {
    command: K;
    data: CommandDataMap[K];
  }
}[keyof CommandDataMap];


interface Chat { from: 'you' | 'peer', content: string }

function App() {

  const [peerId, setPeerId] = useState<string>("");
  const peerClient = useRef<Peer | null>(null);

  const [scannedId, setScannedId] = useState<string>("");
  const [connectionEstablished, setConnectionEstablished] = useState(false);
  const peerConnection = useRef<any>(undefined);



  const [mode, setMode] = useState<"transmit" | "receive">("transmit");
  const [latency, setLatency] = useState<number>(0);
  const [timeOffset, setTimeOffset] = useState<number>(0);

  const [latencyCheckerId, setLatencyCheckerId] = useState<number | null>(null);


  const [chatText, setChatText] = useState<string>("");
  const [chats, setChats] = useState<Chat[]>([]);


  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File>();
  const [sendingFile, setSendingFile] = useState(false);
  const [peerPreparedFile, setPeerPreparedFile] = useState<{ name: string, bytes: number }>();
  const [peerSendingFile, setPeerSendingFile] = useState(false);
  const [peerPartition, setPeerPartition] = useState(0);
  const peerSentFiles = useRef<ArrayBuffer[]>([])

  const [sendingFilePartition, setSendingFilePartition] = useState(0);
  const [sendingFileFinished, setSendingFileFinished] = useState(false);
  const [recommendedChunkSize, setRecommendedChunkSize] = useState<number | false>(false);


  const fileDrop = (file: File) => {
    setSendingFilePartition(0);
    setSendingFileFinished(false);
    console.log(`📂 [packet_] File named ${file.name} has been selected for upload`)
    setSelectedFile(file)

    if (peerConnection.current) {
      peerConnection.current.send(JSON.stringify(
        {
          command: "filePrepared",
          data: {
            name: file.name,
            bytes: file.size,
          }
        } as Command))
    }
  }

  const fileSend = (file: File) => {
    if (!sendingFile && recommendedChunkSize) {
      setSendingFilePartition(0);
      setSendingFile(true);

      peerConnection.current.send(JSON.stringify({
        command: "filePeerSending",
        data: true
      } as Command))

      const chunkSize = recommendedChunkSize;
      const reader = new FileReader();
      let offset = 0;

      reader.onload = async (e) => {
        if (e.target) {
          peerConnection.current.send(JSON.stringify(
            {
              command: "filePeerPacket",
              data: { partition: offset }
            } as Command
          ));
          peerConnection.current.send(e.target.result);
          // console.log("bufferedAmount:", peerConnection.current.bufferedAmount);

          console.log(`📨 [packet_] Sending ${Math.floor(chunkSize / 1024)}KB (partition ${offset}) over to peer`)
        }
        offset += chunkSize;

        setSendingFilePartition(offset / chunkSize);


        if (offset < file.size) {
          if (((offset / chunkSize) % 15 === 0) || peerConnection.current.bufferedAmount > 500_000) {
            console.log(`⏱️ [packet_] Waiting for 0.1s to let possible WebRTC congestion clear up`)
            await new Promise(r => setTimeout(r, 100));
          }
          readSlice(offset);
        } else {
          peerConnection.current.send(JSON.stringify(
            {
              command: "fileFinished",
              data: { name: selectedFile?.name }
            } as Command
          ));
          console.log(`✅️ [packet_] ${selectedFile?.name} File has been successfully sent!`);
          setSendingFile(false);
          setSendingFileFinished(true);
        }
      };

      function readSlice(o: number) {
        const slice = file.slice(o, o + chunkSize);
        reader.readAsArrayBuffer(slice);
      }

      readSlice(0)
    }
  }

  const initializeClient = () => {
    console.log("🔧 [packet_] Initializing Peer client...");
    peerClient.current = new Peer();

    peerClient.current
      .on("open", (id) => {
        setPeerId(id);
        console.log(`🔧 [packet_] Ready, my ID: ${id}`);
      })
      .on("connection", (conn) => {
        console.log("🔧 [packet_] Incoming connection detected ✅ (Receiver)");
        console.log("🔧 [packet_] Waiting for the other side to give us our time offsets");



        peerConnection.current = conn;
        attachDataHandler(conn);
        setConnectionEstablished(true);
      });
  };

  async function runThroughputTest() {
    console.log("⚡️ [packet_] Testing throughput ongoing...")
    const conn = peerConnection.current
    const testSizes = [2048, 4096, 8192, 16384, 32768];
    let bestSize = 2048;
    let bestRate = 0;

    for (const size of testSizes) {
      console.log(`⚡️ [packet_] Testing throughput for ${size} byte chunks...`)
      const buffer = new Uint8Array(size);
      const start = performance.now();

      const promise = new Promise<void>(resolve => {
        const onAck = (raw: string) => {
          const msg: Command = JSON.parse(raw)
          if (msg.command === "speedAck") {
            conn.off("data", onAck);
            resolve();
          }
        };
        conn.on("data", onAck);
      });

      conn.send(JSON.stringify({ command: "speedTest", data: buffer }));
      console.log("⚡️ [packet_] Sent buffer, waiting for reply from peer...")
      await promise;


      const elapsed = performance.now() - start;
      const rate = (size * 2) / (elapsed / 1000); // bytes/sec round-trip

      console.log(`⚡ [packet_] ${size / 1024}KB chunk: ${(rate / 1024).toFixed(1)} KB/s`);

      if (rate > bestRate) {
        bestRate = rate;
        bestSize = size;
      }

      await new Promise(r => setTimeout(r, 50)); // small delay between tests
    }

    return Math.floor(bestSize * 2);
  }


  const attachDataHandler = (conn: any) => {
    conn.on("data", (data: any) => {
      let msg: Command | undefined
      try {
        msg = JSON.parse(data);
        console.log("📩 [packet_] Received:", msg);
      } catch (e) {
        if (data instanceof ArrayBuffer || data?.buffer instanceof ArrayBuffer) {
          console.log("📦️ [packet_] Recognized hopefully a binary chunk, appending (and hoping for the best)");
          peerSentFiles.current.push(
            data instanceof ArrayBuffer ? data : data.buffer
          );
        }

      }

      if (!msg) {
        console.warn("❌️ [packet_] Malformed packet, skipping over!")
        return;
      }



      switch (msg.command) {
        case "ping":
          conn.send(JSON.stringify({ command: "pong", data: msg.data } as Command));
          break;

        case "pong":
          const latency = Date.now() - msg.data;
          setLatency(latency);
          console.log(`📡 [packet_] Pong received — latency ${latency}ms`);
          break;

        case "filePrepared":
          
          console.log("☁️ [packet_] File from peer is prepared")
          setPeerPreparedFile(msg.data)
          break;

        case "fileCancelPrepare":
          setSendingFilePartition(0);
          setPeerPartition(0);
          setPeerSendingFile(false);
          setSendingFileFinished(false);
          peerSentFiles.current = []
          console.log("☁️ [packet_] Peer cancelled preparation")
          setPeerPreparedFile(undefined)
          break;

        case "filePeerSending":
          setPeerSendingFile(true);
          break;

        case "filePeerPacket":
          setPeerPartition(msg.data.partition)
          break;


        // case "filePeerPacketBlob":

        //   break;

        case "fileFinished":
          console.log("✅️ [packet_] File has been successfully received!")
          setSendingFileFinished(true);
          break;

        case "message":
          console.log("💬 [packet_] Got a message from peer")
          setChats(chats => {
            return [...chats, { from: "peer", content: msg.data }]
          })
          break;

        case "timeSync":
          const now = Date.now();
          console.log(`🕐 [packet_] timeSync received (T1=${msg.data.T1})`);
          conn.send(
            JSON.stringify({
              command: "timeSyncResponse",
              data: { T1: msg.data.T1, T2: now },
            } as Command)
          );
          console.log(`↩️ [packet_] Sent timeSyncResponse (T1=${msg.data.T1}, T2=${now})`);
          break;

        case "timeSyncResponse":
          console.log("🕐 [packet_] Received timeSyncResponse (should be handled by host)");
          break;

        case "timeSyncResult":
          const offset = msg.data;
          setTimeOffset(offset);
          console.log(
            `✅ [packet_] Time offset synced: ${offset.toFixed(2)}ms (${offset > 0 ? "we're ahead" : "we're behind"
            })`
          );

          runThroughputTest().then(optimalSize => {
            console.log(`📊 [packet_] Optimal chunk size: ${Math.round(optimalSize / 1024)} KB`);
            conn.send(JSON.stringify({
              command: "speedResult",
              data: optimalSize
            } as Command))
            setRecommendedChunkSize(optimalSize);
          });

          conn.peerConnection.getStats().then((stats: any) => {
            // console.log(stats)
            stats.forEach((report: any) => {
              // console.log(report)
              if (report.type === "candidate-pair" && report.state == "succeeded") {
                console.log(`🔧 [packet_] Local candidate type: ${report.localCandidateType}`);
                console.log(`🔧 [packet_] Remote candidate type: ${report.remoteCandidateType}`);
              }
            });
          });

          break;

        case "speedTest":
          console.log("⚡️ [packet_] Throughput testing from peer, sending back reply")
          conn.send(JSON.stringify({ command: "speedAck" } as Command));
          break;

        case "speedResult":
          console.log(`📊 [packet_] Peer decided on ${Math.round(msg.data / 1024)}KB chunks for sent files`)
          setRecommendedChunkSize(msg.data)
          break;

      }
    });
  };

  const measureRoundTripLatency = () => {
    if (!peerConnection.current) return;
    const start = Date.now();
    peerConnection.current.send(
      JSON.stringify({ command: "ping", data: start } as Command)
    );
    console.log("⏱️ [packet_] Sent ping:", start);
  };

  const synchronizeTimeOffset = async (conn: any, rounds = 5): Promise<number> => {
    console.log(`🔧 [packet_] Starting ${rounds}-round offset sync...`);
    const offsets: number[] = [];

    for (let i = 0; i < rounds; i++) {
      const offset = await new Promise<number>((resolve) => {
        const T1 = Date.now();

        const handler = (raw: string) => {
          const msg = JSON.parse(raw);
          if (msg.command === "timeSyncResponse" && msg.data.T1 === T1) {
            const T4 = Date.now();
            const { T1, T2 } = msg.data;
            const offset = ((T2 - T1) + (T2 - T4)) / 2;
            conn.off("data", handler);
            console.log(
              `🧮 [packet_] Round ${i + 1}: T1=${T1}, T2=${T2}, T4=${T4}, offset=${offset.toFixed(2)}ms`
            );
            resolve(offset);
          }
        };

        conn.on("data", handler);
        conn.send(JSON.stringify({ command: "timeSync", data: { T1 } } as Command));
      });

      offsets.push(offset);
      await new Promise((r) => setTimeout(r, 150));
    }

    const avg = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    console.log(`✅ [packet_] Average offset: ${avg.toFixed(2)}ms`);
    return avg;
  };

  useEffect(() => {
    initializeClient();
  }, []);

  useEffect(() => {
    if (scannedId === "" || !peerClient.current) return;

    console.log(`🔧 [packet_] Connecting to ${scannedId} (Initiator mode)`);
    const conn = peerClient.current.connect(scannedId, {
      reliable: true
    });
    peerConnection.current = conn;

    conn.on("open", () => {
      console.log("🔧 [packet_] Connection established ✅ (Initiator)");
      attachDataHandler(conn);
      setConnectionEstablished(true);
      measureRoundTripLatency();

      synchronizeTimeOffset(conn, 5).then((offset) => {
        setTimeOffset(offset);
        console.log(
          `✅ [packet_] Time offset synced: ${offset.toFixed(2)}ms (${offset > 0 ? "peer ahead" : "peer behind"
          })`
        );
        conn.send(JSON.stringify({
          command: "timeSyncResult", data: offset
        } as Command))
      });
    });
  }, [scannedId]);

  const rerollId = () => {
    console.log("🔧 [packet_] Rerolling Peer ID...")
    if (peerClient.current) {
      peerClient.current.destroy()
    }
    setPeerId("")
    initializeClient()
  };
  useEffect(() => {
    if (connectionEstablished && latencyCheckerId === null) {
      const id = window.setInterval(() => {
        measureRoundTripLatency();
      }, 2000);
      setLatencyCheckerId(id);
    }
    if (!connectionEstablished && latencyCheckerId !== null) {
      window.clearInterval(latencyCheckerId);
      setLatencyCheckerId(null);
    }
  }, [connectionEstablished]);

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerConnection.current) return;
    if (chatText === "") return;

    console.log("💬 [packet_] Sending a chat to peer")

    peerConnection.current.send(JSON.stringify({
      command: 'message',
      data: chatText
    } as Command))

    setChats(chats => {
      return [...chats, { from: "you", content: chatText }]
    })
    setChatText("")
  }

  return (
    <div className="w-full min-h-dvh h-dvh flex flex-col gap-2 justify-start px-8 py-12 pb-4 md:py-4">
      <Header />
      <Mode hide={connectionEstablished} mode={mode} setMode={setMode} />

      <AnimatePresence mode="popLayout">
        {

          (connectionEstablished && timeOffset !== 0 && recommendedChunkSize) && (
            <motion.div
              key="connected"
              initial={{ scale: 0.9, opacity: 0, filter: 'blur(50px)' }}
              animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
              transition={{ ease: 'easeInOut', duration: 3, delay: 1 + -(timeOffset / 1000) }}
              className="w-full flex-1 flex flex-col justify-start md:justify-center items-center gap-4 max-h-[600px] md:my-auto">
              <div
                className="flex-2 border border-white/50 rounded-2xl w-full flex flex-col gap-2 justify-center items-center"
              >
                <AnimatePresence mode="popLayout">
                  {
                    (() => {
                      if (selectedFile) {
                        return (
                          <motion.div
                            key="readyToUpload"
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (e.dataTransfer.files.length > 0) {
                                fileDrop(e.dataTransfer.files[0]);
                              }
                            }}

                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            transition={{ duration: 0.2 }}

                            className="w-full h-full flex flex-col md:flex-row gap-4 justify-center md:justify-between items-stretch relative py-8">
                            <div className="flex flex-col gap-2 px-[3vw] items-center md:items-start">
                              <motion.div
                              initial={{ x: 0, opacity: 1 }}
                              animate={sendingFileFinished ? { x: 200, opacity: 0 } : { x: 0, opacity: 1 }}
                              transition={{ ease: 'easeInOut', duration: 3, delay: -(timeOffset / 1000) }}
                              className="flex-1 h-full w-fit border border-white/10 rounded-xl p-4 flex items-center">
                                <File size={100} />
                              </motion.div>
                              <p className="opacity-70 font-mono max-w-[80%] lg:max-w-1/2 break-all">{selectedFile.name}</p>
                              <p className="opacity-80 font-mono text-lg">{formatBytes(selectedFile.size)}</p>
                              <p className="opacity-30 font-mono text-xs">{Math.ceil(selectedFile.size / (recommendedChunkSize))} packets</p>
                              <AnimatePresence mode="popLayout">
                                {sendingFileFinished ? (
                                  <motion.div
                                    key="finishedSending"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 0.8, y: 0 }}
                                    className="flex flex-col gap-2 items-center md:items-start">
                                    <p className="font-mono">Finished sending!</p>
                                    <Button variant='glass' onClick={() => {
                                      setSelectedFile(undefined);
                                      setSendingFileFinished(false);
                                      setSendingFilePartition(0);

                                      if (peerConnection.current) {
                                        peerConnection.current.send(JSON.stringify({
                                          command: "fileCancelPrepare",
                                          data: true
                                        } as Command))
                                      }
                                    }}><p>Close file</p></Button>
                                  </motion.div>
                                ) : sendingFile ? (
                                  <motion.p
                                    key="sending"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 0.3, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    className="font-mono opacity-30">Sending
                                    <span className="blink">...</span>
                                  </motion.p>
                                ) : (
                                  <motion.div
                                    key="control"
                                    exit={{ scaleY: 0, opacity: 0 }}
                                    className="flex flex-row gap-2 mt-2 origin-top">
                                    <Button onClick={() => { fileSend(selectedFile) }}><p>Start transmission</p></Button>
                                    <Button variant='glass' onClick={() => {
                                      setSelectedFile(undefined);

                                      if (peerConnection.current) {
                                        peerConnection.current.send(JSON.stringify({
                                          command: "fileCancelPrepare",
                                          data: true
                                        } as Command))
                                      }
                                    }}><p>Cancel</p></Button>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                            <div className="flex flex-col justify-center items-center md:items-end gap-2 px-[3vw] flex-1">
                              <div className="border border-white/10 max-w-80 w-full rounded-xl flex flex-col justify-between overflow-hidden">
                                <div className="p-4 font-mono opacity-50 text-xs flex-1 flex flex-col justify-end gap-2 max-h-60 min-h-60 h-full grow self-stretch">
                                  <p>ready to transmit<span className='blink'>_</span></p>
                                  {Array.from({ length: sendingFilePartition }, (_, i) => i + 1).map((packet) => {
                                    return (
                                      <p>transmitting packet {packet}</p>
                                    )
                                  })}
                                </div>
                                <div className="border-t border-white/10 py-4 flex items-center px-4 relative">
                                  <p className="font-mono text-lg opacity-80">{sendingFilePartition}/{Math.ceil(selectedFile.size / (recommendedChunkSize))} packets sent</p>
                                  <div
                                    style={{
                                      clipPath: `inset(0% ${Math.abs(((Math.min(sendingFilePartition * recommendedChunkSize, selectedFile.size) / selectedFile.size) * 100) - 100)}% 0% 0%)`
                                    }}
                                    className="absolute top-0 left-0 bg-white w-full h-full flex items-center p-4">
                                    <p className="font-mono text-lg opacity-80 text-black">{sendingFilePartition}/{Math.ceil(selectedFile.size / (recommendedChunkSize))} packets sent</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        )
                      } else if (peerPreparedFile) {
                        return (
                          <motion.div
                            key="peerAlreadyPrepapedFile"
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (e.dataTransfer.files.length > 0) {
                                fileDrop(e.dataTransfer.files[0]);
                              }
                            }}

                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            transition={{ duration: 0.2 }}

                            className="w-full h-full flex flex-row gap-2 justify-center md:justify-center items-center relative">
                            <div className="flex flex-col gap-2 items-center md:items-end px-[3vw] py-6 w-full">
                              <motion.div
                              initial={{ x: -200, opacity: 0 }}
                              animate={sendingFileFinished ? { x: 0, opacity: 1 } : { x: -200, opacity: 0 }}
                              transition={{ ease: 'easeInOut', duration: 3, delay: 3 }}
                              className="flex-1 h-full w-fit border border-white/10 rounded-xl p-4 flex items-center">
                                <File size={100} />
                              </motion.div>
                              <p className="opacity-70 font-mono max-w-3/4 text-end">{peerPreparedFile.name}</p>
                              <p className="opacity-80 font-mono text-lg">{formatBytes(peerPreparedFile.bytes)}</p>
                              <p className="opacity-30 font-mono text-xs">{Math.floor(peerPreparedFile.bytes / (recommendedChunkSize))} packets</p>
                              <AnimatePresence mode="popLayout">
                                {!sendingFileFinished ? (
                                  <motion.div
                                    key={"sendingProgress"}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ type: 'spring', mass: 1, stiffness: 160, damping: 16 }}
                                    className="border border-white/10 py-4 flex items-center px-4 relative mt-8 overflow-hidden rounded-xl">
                                    {
                                      peerSendingFile ? (
                                        <p className="font-mono text-lg opacity-80 text-nowrap">{peerPartition / recommendedChunkSize}/{Math.ceil(peerPreparedFile.bytes / (recommendedChunkSize))} packets received</p>
                                      ) :
                                        (<p>
                                          <p className="font-mono text-md md:text-lg opacity-80 text-nowrap">waiting for peer to transmit<span className="blink">...</span></p>
                                        </p>)
                                    }
                                    <div
                                      style={{
                                        clipPath: `inset(0% ${Math.abs(((Math.min(peerPartition, peerPreparedFile.bytes) / peerPreparedFile.bytes) * 100) - 100)}% 0% 0%)`
                                      }}
                                      className="absolute top-0 left-0 bg-white w-full h-full flex items-center p-4">
                                      <p className="font-mono text-lg opacity-80 text-black">{(peerPartition / recommendedChunkSize)}/{Math.ceil(peerPreparedFile.bytes / (recommendedChunkSize))} packets received</p>
                                    </div>
                                  </motion.div>
                                ) : (
                                  <motion.div
                                    key="storeToDisk"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ type: 'spring', mass: 1, stiffness: 160, damping: 16 }}
                                    className="mt-8">
                                    <Button onClick={() => {
                                      const fileName = peerPreparedFile.name;
                                      const blob = new Blob(peerSentFiles.current);
                                      const url = URL.createObjectURL(blob);

                                      const a = document.createElement('a');
                                      a.href = url;
                                      a.download = fileName || "file";
                                      a.click();

                                      // console.log('File received!');
                                      peerSentFiles.current = [];
                                    }}><p>Store to disk</p></Button>
                                  </motion.div>
                                )}
                              </AnimatePresence>

                            </div>
                          </motion.div>
                        )
                      } else {
                        return (
                          <motion.div
                            key="uploadScreenFirst"
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (e.dataTransfer.files.length > 0) {
                                fileDrop(e.dataTransfer.files[0]);
                              }
                            }}

                            initial={{ scale: 1.05, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 1.05, opacity: 0 }}
                            transition={{ duration: 0.2 }}

                            className="w-full h-full flex flex-col gap-2 justify-center items-center relative">
                            <Upload size={100} />
                            <p className="opacity-50">Drag over or click here to select a file</p>

                            <input
                              onChange={(e) => {
                                if (e.target.files) {
                                  fileDrop(e.target.files[0])
                                }
                              }}
                              ref={fileInputRef}
                              type="file"
                              className="absolute w-full h-full hidden"
                            />
                          </motion.div>
                        )
                      }
                    })()
                  }
                </AnimatePresence>
              </div>

              <div className="flex flex-col lg:flex-row w-full flex-1 gap-4">
                <div className="flex flex-col justify-between border flex-1 border-white/10 rounded-2xl w-full min-h-full order-1 lg:-order-1 p-4">
                  <h2 className="font-mono text-xs md:text-md opacity-50 mb-2">connected<span className="blink">_</span></h2>
                  <div className="border border-white/10 rounded-2xl p-4 flex justify-around">

                    <div className="flex flex-col">
                      <h1 className="font-mono opacity-50 text-sm">Latency</h1>
                      <p className="font-mono opacity-80 text-lg">{latency}ms</p>
                    </div>
                    <div className="flex flex-col">
                      <h1 className="font-mono opacity-50 text-sm">Transfer speed</h1>
                      <p className="font-mono opacity-80 text-lg">---mbps</p> {/* soon */}
                    </div>
                    {/* <div className="flex flex-col">
                      <h1 className="font-mono opacity-50 text-sm">Possible throughput</h1>
                      <p className="font-mono opacity-80 text-lg">{formatBytes(recommendedChunkSize)}</p>
                    </div> */}
                  </div>
                </div>
                <div className="border flex-1 border-white/10 rounded-2xl w-full max-h-80 min-h-full flex flex-col">
                  <div className="flex-1 w-full min-h-40 overflow-y-scroll  h-full flex flex-col-reverse gap-1 p-4">
                    {[...chats].reverse().map((chat, idx) => {
                      return (
                        <motion.div
                          layout="position"
                          initial={{ y: 10, opacity: 0 }}
                          animate={{ y: 0, opacity: 0.7 }}
                          transition={{
                            duration: 0.3,
                            layout: {
                              type: 'spring', mass: 1, stiffness: 160, damping: 20, delay: (idx + chats.length) / 50
                            }
                          }}
                          style={{ order: idx }} className={`opacity-70 whitespace-pre-wrap max-w-full break-normal font-mono ${chat.from === 'peer' ? "text-red-500" : ""} flex justify-between`}>
                          <p>
                            <span>{chat.from === 'peer' ? "> " : "< "}</span>
                            {chat.content}
                          </p>
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            transition={{ duration: 0.1 }}
                            onClick={() => {
                              navigator.clipboard.writeText(chat.content)
                              toast("Copied to clipboard")
                            }}
                            className="p-2 hover:bg-white/10 rounded-lg">
                            <Copy size={16} />
                          </motion.button>
                        </motion.div>)
                    })}
                  </div>
                  <div className="border-t border-white/20 min-h-8 w-full self-stretch">
                    <form className="relative" onSubmit={sendChat}>
                      <textarea value={chatText} onChange={(e) => setChatText(e.target.value)} className="px-4 py-2 w-full focus:outline-none font-mono" placeholder={"Type something..."}></textarea>
                      <button className="absolute bottom-0 right-0 bg-white p-3 rounded-full text-black m-2" type={"submit"}><Send size={16} /></button>
                    </form>
                  </div>
                </div>
              </div>
            </motion.div>
          )

        }

        {

          !(connectionEstablished && timeOffset !== 0 && recommendedChunkSize) && (
            <motion.div
              key="setup"
              // initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0, filter: 'blur(50px)' }}
              transition={{ ease: 'easeInOut', duration: 3 }}
              className="flex flex-col md:flex-row gap-8 justify-between items-center px-12 my-auto">
              <div className="text-center md:text-start">
                <motion.h2 layout className="font-mono text-xs md:text-md opacity-50 mb-2">welcome to packet<span className="blink">_</span></motion.h2>
                <AnimatePresence mode="popLayout">
                  {mode === "transmit" && (
                    <motion.p
                      key={"transmit"}
                      initial={{ y: -10, opacity: 0, scale: 0.95 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      exit={{ y: -10, opacity: 0, scale: 0.95 }}
                      transition={{ type: 'spring', mass: 1, stiffness: 160, damping: 19 }}
                      className="text-2xl md:text-5xl origin-center md:origin-left md:max-w-160 w-[18rem] md:w-auto font-bold subtle-text-glow">
                      Scan the QR code <span className="hidden md:inline">beside</span><span className="inline md:hidden">below</span> to start connection.
                    </motion.p>
                  )}
                  {mode === "receive" && (
                    <motion.p
                      key={"receive"}
                      initial={{ y: -10, opacity: 0, scale: 0.95 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      exit={{ y: -10, opacity: 0, scale: 0.95 }}
                      transition={{ type: 'spring', mass: 1, stiffness: 160, damping: 19 }}
                      className="text-2xl md:text-5xl origin-center md:origin-left md:max-w-160 w-[18rem] md:w-auto font-bold subtle-text-glow">
                      Scan the QR code on the transmitter&apos;s screen to start connection.
                    </motion.p>
                  )}
                </AnimatePresence>
                <motion.div layout className="mt-4 opacity-30 hover:opacity-80 hover:scale-110 transition-all block w-fit mx-auto md:mx-0">
                  <a href="https://github.com/Joystickplays/packet_" target="_blank" className="w-fit block">
                    <Github />
                  </a>
                </motion.div>
              </div>
              <AnimatePresence mode="popLayout">
                {mode === "transmit" && (
                  <motion.div
                    key={"qrdisplay"}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col gap-4">
                    <div className="p-4 bg-white rounded-2xl w-64 h-64 flex justify-center items-center">
                      <AnimatePresence mode="popLayout">
                        {peerId !== "" ? (
                          <motion.div
                            key={"qr"}
                            initial={{ scale: 0.5, opacity: 0, filter: 'blur(10px)' }}
                            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                            exit={{ scale: 0.9, opacity: 0, filter: 'blur(10px)' }}
                            transition={{ type: 'spring', mass: 1, stiffness: 160, damping: 19 }}
                          >
                            <QRCode value={peerId} size={225} />
                          </motion.div>
                        ) : (
                          <motion.div
                            key={"loading"}
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.5, opacity: 0 }}
                            transition={{ type: 'spring', mass: 1, stiffness: 160, damping: 16 }}
                            className="w-fit">
                            <RotateCw className="animate-spin text-black" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      transition={{ duration: 0.1 }}
                      onClick={rerollId} className="rounded-full scale-70 md:scale-100 font-mono tracking-widest mx-auto flex gap-4 hover:bg-white/10 transition-colors opacity-70 p-2">
                      <RotateCw /> <p>REROLL</p>
                    </motion.button>

                  </motion.div>
                )}
                {mode === "receive" && (
                  <motion.div
                    key={"scanner"}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: scannedId === "" ? 1 : 0.5 }}
                    exit={{ opacity: 0 }}>
                    <motion.div
                      animate={{ filter: scannedId === "" ? 'blur(0px)' : 'blur(10px)' }}
                      className="flex flex-col gap-2 border border-white/10 p-2 rounded-2xl  ">
                      <Scanner classNames={{
                        container: `rounded-2xl  aspect-square !w-64 !h-64 saturate-0`,
                        video: "rounded-xl saturate-0 "
                      }} onScan={(scan) => { setScannedId(scan[0].rawValue) }}
                        components={{
                          onOff: false,
                          torch: false,
                          zoom: true,
                          finder: false
                        }} sound={false} paused={scannedId !== ""}></Scanner>
                    </motion.div>
                    <div className="flex flex-col gap-2 mt-4">
                      <div className="flex gap-4 opacity-50 font-mono text-xs items-center">
                        {scannedId === "" ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Check />
                        )}<p>Waiting for code</p>
                      </div>
                      {scannedId !== "" && (
                        <motion.div
                          initial={{ x: -20, opacity: 0 }}
                          animate={{ x: 0, opacity: 0.5 }}
                          transition={{ type: 'spring', mass: 1, stiffness: 160, damping: 16 }}
                          className="flex gap-4 opacity-50 font-mono text-xs items-center">
                          {!connectionEstablished ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Check />
                          )}<p>Establishing connection</p>
                        </motion.div>
                      )}
                      {scannedId !== "" && connectionEstablished && (
                        <motion.p
                          initial={{ x: -20, opacity: 0 }}
                          animate={{ x: 0, opacity: 0.5 }}
                          transition={{ type: 'spring', mass: 1, stiffness: 160, damping: 16 }}
                          className="flex gap-4 font-mono text-xs items-center opacity-50">
                          {timeOffset === 0 ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Check />
                          )}<p>Synchronizing peers</p>
                        </motion.p>
                      )}
                      {scannedId !== "" && connectionEstablished && timeOffset !== 0 && (
                        <motion.p
                          initial={{ x: -20, opacity: 0 }}
                          animate={{ x: 0, opacity: 0.5 }}
                          transition={{ type: 'spring', mass: 1, stiffness: 160, damping: 16 }}
                          className="flex gap-4 font-mono text-xs items-center opacity-50">
                          {!recommendedChunkSize ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Check />
                          )}<p>Assessing throughput</p>
                        </motion.p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )

        }

      </AnimatePresence>
    </div>
  )
}

export default App
