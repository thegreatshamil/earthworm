"""
n8n Webhook Bridge Service.
Forwards requests to n8n webhook and streams responses back.
"""
import httpx
import json
from typing import Optional, Literal
from config import settings
from .ai_provider import AIProvider


class N8NBridge(AIProvider):
    """
    Bridge service that forwards chat requests to n8n webhook.
    
    This service:
    1. Receives requests from the frontend
    2. Preprocesses data (images, etc.)
    3. Forwards to n8n webhook
    4. Returns the response
    
    Benefits:
    - Security: Hide n8n URLs and API keys
    - Preprocessing: Resize images before sending
    - Stability: Handle n8n downtime gracefully
    """
    
    def __init__(self):
        self.webhook_url = settings.n8n_webhook_url
        self.api_key = settings.n8n_api_key
        self.timeout = 60.0  # 60 second timeout for AI responses
    
    async def chat(
        self,
        text: Optional[str],
        image_base64: Optional[str],
        audio_file: Optional[str],
        session_id: str,
        language: Literal["en", "ta"],
    ) -> str:
        """
        Forward chat request to n8n webhook.
        
        Args:
            text: User's text message
            image_base64: Optional base64 image
            audio_file: Optional base64 audio
            session_id: Session identifier
            language: Language code
            
        Returns:
            AI response from n8n
            
        Raises:
            Exception: If n8n is unreachable or returns error
        """
        import base64
        
        # Clean base64 strings (remove data URI scheme prefix if present)
        def clean_base64(b64_str: Optional[str]) -> Optional[str]:
            if not b64_str: return None
            if "," in b64_str:
                return b64_str.split(",")[1]
            return b64_str
            
        cleaned_image = clean_base64(image_base64)
        cleaned_audio = clean_base64(audio_file)

        # Preprocess image if provided
        processed_image = None
        if cleaned_image:
            processed_image = self.preprocess_image(
                cleaned_image,
                max_width=settings.max_image_width,
                max_height=settings.max_image_height,
                quality=settings.image_quality,
            )
            
        # Prepare headers
        headers = {
            "Accept": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                
                # If we have an audio file, we MUST send as multipart/form-data
                # so n8n can parse it as a binary file called 'audio_base64'
                if cleaned_audio:
                    # Convert base64 audio back to bytes to send as a file
                    audio_bytes = base64.b64decode(cleaned_audio)
                    files = {
                        # Name must match what the n8n workflow expects
                        "audio_base64": ("audio.webm", audio_bytes, "audio/webm")
                    }
                    data = {
                        "text": text or "",
                        "session_id": session_id,
                        "language": language,
                    }
                    if processed_image:
                        data["image_base64"] = processed_image
                        
                    response = await client.post(
                        self.webhook_url,
                        data=data,
                        files=files,
                        headers=headers,
                    )
                else:
                    # No audio? Plain JSON is fine
                    headers["Content-Type"] = "application/json"
                    payload = {
                        "text": text,
                        "image_base64": processed_image,
                        "session_id": session_id,
                        "language": language,
                        "has_image": processed_image is not None,
                        "has_audio": False
                    }
                    
                    response = await client.post(
                        self.webhook_url,
                        json=payload,
                        headers=headers,
                    )
                
                # Handle different response formats
                if response.status_code == 200:
                    try:
                        data = response.json()
                        
                        # Handle array response (common in n8n)
                        if isinstance(data, list) and len(data) > 0:
                            data = data[0]
                            
                        # n8n might return the response in different formats
                        if isinstance(data, str):
                            return data
                        elif isinstance(data, dict):
                            # Try common keys first, then fall back to any 'output' field,
                            # and finally to the raw JSON string.
                            return (
                                data.get("response")
                                or data.get("assistant_reply")
                                or data.get("message")
                                or data.get("text")
                                or data.get("output")
                                or json.dumps(data)
                            )
                        else:
                            return str(data)
                    except json.JSONDecodeError:
                        # If not JSON, return raw text
                        return response.text
                else:
                    raise Exception(f"n8n returned status {response.status_code}: {response.text}")
                    
        except httpx.TimeoutException:
            raise Exception("Request to n8n timed out. The AI service may be busy.")
        except httpx.ConnectError:
            raise Exception("Could not connect to n8n. Please check if the webhook is running.")
        except Exception as e:
            raise Exception(f"Error communicating with n8n: {str(e)}")
    
    async def health_check(self) -> bool:
        """Check if n8n webhook is accessible."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                # Try a simple GET request to check connectivity
                # Note: n8n webhooks might not support GET, so this may need adjustment
                response = await client.get(self.webhook_url)
                return response.status_code < 500
        except:
            return False
    
    async def stream_chat(
        self,
        text: Optional[str],
        image_base64: Optional[str],
        audio_file: Optional[str],
        session_id: str,
        language: Literal["en", "ta"],
    ):
        """
        Stream chat response from n8n (for future SSE implementation).
        
        This is a placeholder for streaming support.
        Currently just yields the full response.
        """
        response = await self.chat(text, image_base64, audio_file, session_id, language)
        yield response
