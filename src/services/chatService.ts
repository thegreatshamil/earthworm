import type { ChatRequest, ChatResponse, ChatSession } from "@/types";
import type { Language } from "@/context/LanguageContext";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

class ChatService {
  private sessionId: string;

  constructor() {
    this.sessionId = this.generateSessionId();
  }

  private generateSessionId(): string {
    return "session_" + Math.random().toString(36).substring(2, 15);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  resetSession(): void {
    this.sessionId = this.generateSessionId();
  }

  async sendMessage(
    text: string,
    language: Language,
    imageBase64?: string,
    audioFile?: string,
  ): Promise<string> {
    const request: ChatRequest = {
      text,
      image_base64: imageBase64,
      audio_file: audioFile,
      session_id: this.sessionId,
      language,
    };

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.detail || `HTTP error! status: ${response.status}`,
        );
      }

      const data: ChatResponse = await response.json();
      return data.response;
    } catch (error) {
      console.error("Chat API error:", error);

      // Fallback message for demo/development
      if (import.meta.env.DEV) {
        console.warn("Using fallback chat response due to API error");
        return this.getFallbackResponse(text, language);
      }

      throw error;
    }
  }

  private getFallbackResponse(text: string, language: Language): string {
    const responses: Record<Language, string> = {
      en: `I received your message: "${text}". This is a fallback response for development. Please ensure the Python backend is running on port 8000.`,
      hi: `मैंने आपका संदेश प्राप्त किया: "${text}"। यह विकास के लिए एक फॉलबैक प्रतिक्रिया है। कृपया सुनिश्चित करें कि Python बैकएंड पोर्ट 8000 पर चल रहा है।`,
      ta: `உங்கள் செய்தியைப் பெற்றேன்: "${text}". இது வளர்ச்சிக்கான மாற்று பதில். பைதான் பின்தளம் போர்ட் 8000 இல் இயங்குவதை உறுதி செய்யவும்.`,
      te: `మీ సందేశం అందుకున్నాను: "${text}". ఇది అభివృద్ధి కోసం ఫాల్‌బ్యాక్ ప్రతిస్పందన. Python బ్యాక్‌ఎండ్ పోర్ట్ 8000లో నడుస్తోందని నిర్ధారించుకోండి.`,
      kn: `ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಸ್ವೀಕರಿಸಿದ್ದೇನೆ: "${text}". ಇದು ಅಭಿವೃದ್ಧಿಗಾಗಿ ಫಾಲ್‌ಬ್ಯಾಕ್ ಪ್ರತಿಕ್ರಿಯೆ. Python ಬ್ಯಾಕ್‌ಎಂಡ್ ಪೋರ್ಟ್ 8000 ರಲ್ಲಿ ಚಾಲನೆಯಲ್ಲಿದೆ ಎಂದು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.`,
      ml: `നിങ്ങളുടെ സന്ദേശം സ്വീകരിച്ചു: "${text}". ഇത് വികസനത്തിനായുള്ള ഫോൾബാക്ക് പ്രതികരണമാണ്. Python ബാക്ക്എൻഡ് പോർട്ട് 8000-ൽ പ്രവർത്തിക്കുന്നുണ്ടോയെന്ന് ഉറപ്പാക്കുക.`,
      bn: `আমি আপনার বার্তা পেয়েছি: "${text}"। এটি উন্নয়নের জন্য একটি ফলব্যাক প্রতিক্রিয়া। অনুগ্রহ করে নিশ্চিত করুন যে Python ব্যাকএন্ড পোর্ট 8000-এ চলছে।`,
      mr: `मला तुमचा संदेश मिळाला: "${text}". हे विकासासाठी एक फॉलबॅक प्रतिसाद आहे. कृपया खात्री करा की Python बॅकएंड पोर्ट 8000 वर चालू आहे.`,
      gu: `મેં તમારો સંદેશ પ્રાપ્ત કર્યો: "${text}". આ વિકાસ માટે ફોલબેક પ્રતિસાદ છે. કૃપા કરીને ખાતરી કરો કે Python બેકએન્ડ પોર્ટ 8000 પર ચાલી રહ્યું છે.`,
      pa: `ਮੈਂ ਤੁਹਾਡਾ ਸੰਦੇਸ਼ ਪ੍ਰਾਪਤ ਕੀਤਾ: "${text}". ਇਹ ਵਿਕਾਸ ਲਈ ਇੱਕ ਫੌਲਬੈਕ ਜਵਾਬ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਯਕੀਨੀ ਬਣਾਓ ਕਿ Python ਬੈਕਐਂਡ ਪੋਰਟ 8000 'ਤੇ ਚੱਲ ਰਿਹਾ ਹੈ।`,
    };
    return responses[language] || responses["en"];
  }

  // Save chat history to localStorage
  saveChatHistory(session: ChatSession): void {
    const history = this.getChatHistory();
    const existingIndex = history.findIndex((s) => s.id === session.id);

    if (existingIndex >= 0) {
      history[existingIndex] = session;
    } else {
      history.push(session);
    }

    // Keep only last 50 sessions
    if (history.length > 50) {
      history.shift();
    }

    localStorage.setItem("earthworm-chat-history", JSON.stringify(history));
  }

  getChatHistory(): ChatSession[] {
    try {
      const saved = localStorage.getItem("earthworm-chat-history");
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((s: any) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          updatedAt: new Date(s.updatedAt),
          messages: s.messages.map((m: any) => ({
            ...m,
            timestamp: new Date(m.timestamp),
          })),
        }));
      }
    } catch (e) {
      console.error("Error loading chat history:", e);
    }
    return [];
  }

  deleteChatSession(sessionId: string): void {
    const history = this.getChatHistory().filter((s) => s.id !== sessionId);
    localStorage.setItem("earthworm-chat-history", JSON.stringify(history));
  }

  clearAllHistory(): void {
    localStorage.removeItem("earthworm-chat-history");
  }
}

export const chatService = new ChatService();
export default chatService;
