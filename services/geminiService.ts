
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { HealthSlide } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateHealthContent = async (
  topic: string, 
  category: string,
  availableAssetLabels: string[] = []
): Promise<{ title: string; slides: Partial<HealthSlide>[] }> => {
  const assetContext = availableAssetLabels.length > 0 
    ? `Tôi có sẵn các ảnh mẫu với nhãn sau: ${availableAssetLabels.join(", ")}. Hãy cố gắng viết nội dung và imagePrompt khớp với các nhãn này nếu có thể.`
    : "";

  const systemPrompt = `Bạn là một bác sĩ và chuyên gia tư vấn sức khỏe chuyên nghiệp. Hãy tạo một cẩm nang hướng dẫn về chủ đề "${topic}" thuộc danh mục "${category}".
  
  ${assetContext}

  Yêu cầu:
  1. Nội dung phải khoa học, chính xác, dễ hiểu và mang tính thực hành cao.
  2. Chia nội dung thành 6-8 slide (bước hướng dẫn hoặc lời khuyên).
  3. Mỗi slide gồm: 
     - "text": Lời khuyên/Hướng dẫn ngắn gọn (tiếng Việt, tối đa 50 từ).
     - "imagePrompt": Mô tả hình ảnh minh họa y khoa hoặc lifestyle chuyên nghiệp (tiếng Anh, chi tiết). Nếu khớp với nhãn ảnh sẵn có, hãy dùng nhãn đó làm trọng tâm mô tả.
  Trả về JSON chuẩn.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: systemPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          slides: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                imagePrompt: { type: Type.STRING }
              },
              required: ["text", "imagePrompt"]
            }
          }
        },
        required: ["title", "slides"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const generateHealthImage = async (imagePrompt: string): Promise<string> => {
  const styleHint = "Professional medical illustration, clean minimalist health clinic aesthetic, soft natural lighting, high-quality photography, realistic and trustworthy look, pastel medical colors (blue, white, soft green).";
  const fullPrompt = `High quality health handbook visual: ${imagePrompt}. Style: ${styleHint}. 8k resolution, professional.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        { text: fullPrompt },
      ],
    },
    config: { imageConfig: { aspectRatio: "16:9" } }
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("Tạo ảnh thất bại");
};

export const generateHealthVoice = async (text: string, voiceName: string = 'Kore'): Promise<string> => {
  if (!text.trim()) return "";
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Đọc với giọng điệu điềm tĩnh, chuyên nghiệp và ân cần: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("Tạo audio thất bại");
  return base64Audio;
};

export const decodePCMToAudioBuffer = async (base64: string, ctx: AudioContext): Promise<AudioBuffer> => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const dataInt16 = new Int16Array(bytes.buffer);
  const frameCount = dataInt16.length;
  const buffer = ctx.createBuffer(1, frameCount, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
};

export const decodeAudio = async (base64: string, ctx: AudioContext): Promise<AudioBuffer> => {
  if (base64.startsWith('data:audio')) {
    const response = await fetch(base64);
    const arrayBuffer = await response.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  }
  return decodePCMToAudioBuffer(base64, ctx);
};
