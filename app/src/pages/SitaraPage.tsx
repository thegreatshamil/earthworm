import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, MessageSquare, Volume2, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import SunflowerField from '@/components/sunflower/SunflowerField';
import type { Page } from '@/types';

interface SitaraPageProps {
    onPageChange: (page: Page) => void;
}

type VoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

interface SitaraWebhookResponse {
    transcript?: string;
    reply?: string;
    audio?: string;
}

interface SitaraHistoryEntry {
    id: string;
    timestamp: Date;
    transcript: string;
    reply: string;
    preview: string;
}

const SITARA_WEBHOOK_URL = 'http://localhost:5678/webhook/sitara';

const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result;
            if (typeof result !== 'string') {
                reject(new Error('Failed to convert blob to base64'));
                return;
            }
            resolve(result.split(',')[1] || '');
        };
        reader.onerror = () => reject(reader.error || new Error('FileReader error'));
        reader.readAsDataURL(blob);
    });

const SitaraPage: React.FC<SitaraPageProps> = ({ onPageChange: _onPageChange }) => {
    const { t, language } = useLanguage();
    const [status, setStatus] = useState<VoiceStatus>('idle');
    const [transcript, setTranscript] = useState('');
    const [subtitle, setSubtitle] = useState('');
    const [displayedSubtitle, setDisplayedSubtitle] = useState('');
    const [subtitlePhase, setSubtitlePhase] = useState<'idle' | 'listening' | 'transcript' | 'reply'>('idle');
    const [showHistory, setShowHistory] = useState(false);
    const [historyEntries, setHistoryEntries] = useState<SitaraHistoryEntry[]>([]);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const wordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pendingBlobPromiseRef = useRef<Promise<Blob | null> | null>(null);
    const subtitleScrollRef = useRef<HTMLDivElement | null>(null);
    const shouldAutoScrollRef = useRef(true);
    const isPressingRef = useRef(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const handleSubtitleScroll = useCallback(() => {
        const el = subtitleScrollRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        shouldAutoScrollRef.current = distanceFromBottom < 24;
    }, []);

    useEffect(() => {
        const el = subtitleScrollRef.current;
        if (!el || !shouldAutoScrollRef.current) return;
        el.scrollTop = el.scrollHeight;
    }, [displayedSubtitle, transcript, subtitlePhase, status]);

    const formatHistoryTimestamp = useCallback((date: Date) => {
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }, []);

    const handleSelectHistoryEntry = useCallback((entry: SitaraHistoryEntry) => {
        setTranscript(entry.transcript);
        setSubtitle(entry.reply);
        setSubtitlePhase('reply');
        setShowHistory(false);
        shouldAutoScrollRef.current = true;
    }, []);

    // Text reveal effect
    useEffect(() => {
        if (!subtitle) {
            setDisplayedSubtitle('');
            return;
        }

        if (wordIntervalRef.current) {
            clearInterval(wordIntervalRef.current);
            wordIntervalRef.current = null;
        }

        const words = subtitle.split(' ');
        let index = 0;

        setDisplayedSubtitle('');
        wordIntervalRef.current = setInterval(() => {
            index += 1;
            setDisplayedSubtitle(words.slice(0, index).join(' '));
            if (index >= words.length && wordIntervalRef.current) {
                clearInterval(wordIntervalRef.current);
                wordIntervalRef.current = null;
            }
        }, 80);

        return () => {
            if (wordIntervalRef.current) {
                clearInterval(wordIntervalRef.current);
                wordIntervalRef.current = null;
            }
        };
    }, [subtitle]);

    const cleanupMedia = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onstop = null;
            mediaRecorderRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
    };

    const recordAudio = useCallback(async (): Promise<Blob | null> => {
        if (!navigator.mediaDevices?.getUserMedia) {
            console.warn('Media devices not available');
            return null;
        }

        return new Promise<Blob | null>(async (resolve) => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaStreamRef.current = stream;
                const recorder = new MediaRecorder(stream);
                mediaRecorderRef.current = recorder;
                const chunks: BlobPart[] = [];

                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        chunks.push(event.data);
                    }
                };

                recorder.onstop = () => {
                    const blob = chunks.length ? new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }) : null;
                    cleanupMedia();
                    resolve(blob);
                };

                recorder.start();
            } catch (error) {
                console.error('Error starting audio recording', error);
                cleanupMedia();
                resolve(null);
            }
        });
    }, []);

    const sendToBackend = useCallback(async (audioBlob: Blob): Promise<SitaraWebhookResponse> => {
        const base64 = await blobToBase64(audioBlob);
        const existingSessionId = sessionStorage.getItem('sitara_session_id');
        const sessionId = existingSessionId || (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sitara_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
        sessionStorage.setItem('sitara_session_id', sessionId);

        const response = await fetch(SITARA_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audio: base64,
                session_id: sessionId,
                language,
                content_type: 'audio/webm',
            }),
        });

        if (!response.ok) {
            throw new Error(`Webhook request failed (${response.status})`);
        }

        const text = await response.text();
        if (!text || text.trim() === '') {
            throw new Error('Empty response from server');
        }
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error('Invalid JSON response: ' + text.substring(0, 100));
        }

        return data;
    }, [language]);

    const playAudio = useCallback((base64Audio: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            try {
                console.log('playAudio called, base64 length:', base64Audio?.length);
                const binary = atob(base64Audio);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i += 1) {
                    bytes[i] = binary.charCodeAt(i);
                }

                const blob = new Blob([bytes], { type: 'audio/wav; codecs=1' });
                console.log('Blob created, size:', blob.size, 'type:', blob.type);
                const url = URL.createObjectURL(blob);
                audioRef.current = new Audio(url);
                audioRef.current.preload = 'auto';

                audioRef.current.onended = () => {
                    URL.revokeObjectURL(url);
                    resolve();
                };
                audioRef.current.onerror = () => {
                    reject(new Error('Audio playback failed'));
                };

                console.log('Attempting to play audio...');
                audioRef.current.load();
                audioRef.current.addEventListener('canplaythrough', () => {
                    audioRef.current?.play()
                        .then(() => console.log('Playing'))
                        .catch(e => console.error('Failed:', e));
                }, { once: true });
            } catch (err) {
                reject(err);
            }
        });
    }, []);

    const playTTSResponse = useCallback(async (text: string, base64Audio?: string) => {
        setStatus('speaking');
        setSubtitle(text);

        if (base64Audio) {
            try {
                await playAudio(base64Audio);
            } catch (error) {
                console.error('Audio playback error:', error);
            }
        } else {
            const estimatedDuration = Math.max(1800, text.split(' ').length * 160);
            await new Promise(resolve => setTimeout(resolve, estimatedDuration));
        }

        setStatus('idle');
    }, [playAudio]);

    const handlePressStart = async () => {
        if (status === 'speaking' || isPressingRef.current) return;

        isPressingRef.current = true;
        setStatus('listening');
        setTranscript('');
        setSubtitlePhase('listening');

        pendingBlobPromiseRef.current = recordAudio();
    };

    const handlePressEnd = async () => {
        if (!isPressingRef.current) return;
        isPressingRef.current = false;

        const pending = pendingBlobPromiseRef.current;
        pendingBlobPromiseRef.current = null;

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        }

        if (!pending) {
            setStatus('idle');
            setSubtitlePhase('idle');
            return;
        }

        const blob = await pending;
        if (!blob) {
            setStatus('idle');
            setSubtitlePhase('idle');
            return;
        }

        try {
            setStatus('thinking');
            const response = await sendToBackend(blob);
            const transcriptText = response.transcript || '';
            const replyText = response.reply || t('sitaraPlaceholderResponse');
            const previewBase = transcriptText.replace(/\s+/g, ' ').trim();
            const preview = previewBase
                ? previewBase.split(' ').slice(0, 8).join(' ')
                : t('statusListening');

            setHistoryEntries((prev) => [
                {
                    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    timestamp: new Date(),
                    transcript: transcriptText,
                    reply: replyText,
                    preview,
                },
                ...prev,
            ]);

            setTranscript(transcriptText);
            setSubtitlePhase('transcript');
            setSubtitle(replyText);

            // Let transcript appear first, then fade to Sitara reply.
            await new Promise(resolve => setTimeout(resolve, 300));
            setSubtitlePhase('reply');
            setSubtitle(replyText);

            await playTTSResponse(replyText, response.audio);
        } catch (error) {
            console.error('Sitara backend error:', error);
            const fallback = t('sitaraPlaceholderResponse');
            setTranscript('');
            setSubtitle(fallback);
            setSubtitlePhase('reply');
            await playTTSResponse(fallback);
        }
    };

    useEffect(() => {
        return () => {
            cleanupMedia();
            if (wordIntervalRef.current) {
                clearInterval(wordIntervalRef.current);
            }
        };
    }, []);

    const statusLabel = (() => {
        switch (status) {
            case 'listening':
                return t('statusListening');
            case 'thinking':
                return t('statusThinking');
            case 'speaking':
                return t('statusSpeaking');
            default:
                return t('statusIdle');
        }
    })();
    const reply = subtitle;

    const sunflowerAnimation = (() => {
        if (status === 'listening') {
            return {
                scale: [1, 1.08, 1],
                transition: { repeat: Infinity, duration: 1.2, ease: 'easeInOut' },
            } as const;
        }
        if (status === 'speaking') {
            return {
                rotate: [-2, 2, -2],
                translateY: [0, -4, 0],
                transition: { repeat: Infinity, duration: 1.8, ease: 'easeInOut' },
            } as const;
        }
        return {
            scale: 1,
            rotate: 0,
            translateY: 0,
        } as const;
    })();

    return (
        <div className="relative h-[100dvh] overflow-hidden">
            <div className="relative z-[10] pointer-events-none">
                <SunflowerField />
            </div>

            <div className="relative z-10 h-full pt-24 px-4 md:px-8 pb-4 overflow-hidden">
                <div className="mx-auto max-w-6xl h-full overflow-hidden">
                    <div className="flex h-full min-h-0 items-stretch gap-4 overflow-hidden">
                        {/* Sidebar (push layout) */}
                        <div
                            style={{ width: showHistory ? 280 : 0, transition: 'width 250ms ease' }}
                            className="h-full shrink-0 overflow-hidden"
                        >
                            <div className="relative w-[280px] h-full glass-sidebar rounded-3xl border border-white/10 flex flex-col overflow-hidden">
                                <div className="absolute inset-0 pointer-events-none">
                                    <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-white/[0.05] to-transparent" />
                                    <div className="absolute top-10 left-4 w-20 h-20 bg-white/[0.03] rounded-full blur-2xl" />
                                </div>

                                <div className="flex items-center justify-between p-4 border-b border-white/[0.08] relative z-10">
                                    <span className="text-white/90 text-sm font-medium">{t('previousConversations')}</span>
                                    <motion.button
                                        onClick={() => setShowHistory(false)}
                                        whileHover={{ scale: 1.1, rotate: 90 }}
                                        whileTap={{ scale: 0.9 }}
                                        className="p-2 rounded-xl hover:bg-white/10 text-white/50 transition-colors"
                                        title={t('previousConversations')}
                                    >
                                        <X className="w-4 h-4" />
                                    </motion.button>
                                </div>

                                <div className="flex-1 overflow-y-auto px-3 pb-4 relative z-10">
                                    {historyEntries.length === 0 ? (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="text-center py-8"
                                        >
                                            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
                                                <MessageSquare className="w-6 h-6 text-white/20" />
                                            </div>
                                            <p className="text-white/40 text-sm">{t('noChatsYet')}</p>
                                        </motion.div>
                                    ) : (
                                        <div className="space-y-1">
                                            <AnimatePresence mode="popLayout">
                                                {historyEntries.map((entry, index) => (
                                                    <motion.div
                                                        key={entry.id}
                                                        initial={{ opacity: 0, x: -20 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        exit={{ opacity: 0, scale: 0.95 }}
                                                        transition={{ delay: index * 0.03 }}
                                                        className="group relative"
                                                    >
                                                        <button
                                                            onClick={() => handleSelectHistoryEntry(entry)}
                                                            className="w-full text-left px-4 py-3 rounded-xl transition-all duration-200 text-white/60 hover:text-white/80 border border-transparent hover:bg-white/5"
                                                        >
                                                            <p className="text-sm font-medium truncate pr-6">{entry.preview}</p>
                                                            <p className="text-xs text-white/35 mt-0.5">
                                                                {formatHistoryTimestamp(entry.timestamp)}
                                                            </p>
                                                        </button>
                                                    </motion.div>
                                                ))}
                                            </AnimatePresence>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Main Sitara area */}
                        <div className="relative h-full flex-1 min-w-0 overflow-hidden">
                            <div className="absolute left-0 top-0 z-20">
                                <motion.button
                                    onClick={() => setShowHistory((prev) => !prev)}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    className="p-3 rounded-2xl bg-[#f4d03f]/15 border border-[#f4d03f]/25 text-[#fff7d6] hover:text-white transition-colors"
                                    title={t('previousConversations')}
                                >
                                    <Clock className="w-5 h-5" />
                                </motion.button>
                            </div>

                            <div className="relative z-10 flex h-full min-h-0 flex-col items-center px-6 pb-6 overflow-hidden">
                                {/* Header */}
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4 }}
                                    className="text-center mb-8 shrink-0"
                                >
                                    <h1 className="text-3xl md:text-4xl font-semibold text-white mb-1 tracking-tight">
                                        {t('sitaraAI')}
                                    </h1>
                                    <p className="text-sm md:text-base text-white/70 max-w-md mx-auto">
                                        {t('sitaraSubtitle')}
                                    </p>
                                </motion.div>

                                {/* Status label */}
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.2 }}
                                    className="mb-6 shrink-0"
                                >
                                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass">
                                        <span className="w-2 h-2 rounded-full bg-[#f4d03f] animate-pulse" />
                                        <span className="text-xs md:text-sm text-white/80 font-medium tracking-wide uppercase">
                                            {statusLabel}
                                        </span>
                                    </div>
                                </motion.div>

                                {/* Sunflower mic button */}
                                <motion.button
                                    type="button"
                                    whileTap={{ scale: 0.96 }}
                                    animate={sunflowerAnimation as any}
                                    onPointerDown={handlePressStart}
                                    onPointerUp={handlePressEnd}
                                    onPointerLeave={handlePressEnd}
                                    onPointerCancel={handlePressEnd}
                                    className="
                        relative w-[220px] h-[220px] min-w-[220px] min-h-[220px] aspect-square rounded-[50%] shrink-0
            flex items-center justify-center
            bg-gradient-to-br from-[#f9e79f] via-[#f4d03f] to-[#b7950b]
            shadow-[0_0_60px_rgba(244,208,63,0.45)]
            border-4 border-amber-200/60
            overflow-hidden
          "
                                >
                                    {/* Petal ring */}
                                    <div className="absolute inset-[-18%] rounded-[50%] overflow-hidden">
                                        <div className="w-full h-full animate-[spin_18s_linear_infinite] rounded-[50%] overflow-hidden">
                                            <div className="absolute inset-0 rounded-[50%] overflow-hidden">
                                                {Array.from({ length: 16 }).map((_, i) => (
                                                    <div
                                                        key={i}
                                                        className="absolute left-1/2 top-0 w-6 h-10 md:w-7 md:h-12 -translate-x-1/2 origin-[50%_100%] rounded-[50%] overflow-hidden bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500"
                                                        style={{ transform: `rotate(${(360 / 16) * i}deg) translateY(-12%)` }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Center disk */}
                                    <div className="relative w-24 h-24 md:w-30 md:h-30 rounded-[50%] overflow-hidden bg-gradient-to-br from-amber-900 via-amber-800 to-amber-900 flex items-center justify-center">
                                        <div className="w-16 h-16 rounded-[50%] overflow-hidden bg-gradient-to-br from-amber-700 to-amber-900 flex items-center justify-center">
                                            <Volume2 className="w-7 h-7 md:w-8 md:h-8 text-amber-200" />
                                        </div>
                                    </div>
                                </motion.button>

                                {/* Helper text */}
                                <p className="mt-4 text-xs md:text-sm text-white/60 shrink-0">
                                    {t('sitaraHint')}
                                </p>

                                {transcript && (
                                    <div style={{
                                        fontSize: '0.8rem',
                                        color: 'rgba(255,255,255,0.7)',
                                        textAlign: 'center',
                                        padding: '4px 8px',
                                        marginBottom: '8px'
                                    }}>
                                        {transcript}
                                    </div>
                                )}

                                {reply && (
                                    <div
                                        ref={subtitleScrollRef}
                                        onScroll={handleSubtitleScroll}
                                        style={{
                                            overflowY: 'scroll',
                                            maxHeight: '150px',
                                            zIndex: 100,
                                            position: 'relative',
                                            pointerEvents: 'auto',
                                            background: 'rgba(0,0,0,0.5)',
                                            backdropFilter: 'blur(10px)',
                                            borderRadius: '20px',
                                            padding: '14px 20px',
                                            width: '70%',
                                            margin: '0 auto',
                                            fontSize: '0.9rem',
                                            color: 'white'
                                        }}
                                    >
                                        ✦ Sitara: {reply}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SitaraPage;
