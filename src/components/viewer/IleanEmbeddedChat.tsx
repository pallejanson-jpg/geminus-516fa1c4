import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useIleanData } from '@/hooks/useIleanData';
import ReactMarkdown from 'react-markdown';

interface IleanEmbeddedChatProps {
  buildingFmGuid?: string;
  buildingName?: string;
}

const STARTER_QUESTIONS = [
  'What documents are available for this building?',
  'Are there operation cards for the ventilation?',
  'What does the fire safety documentation say?',
];

export default function IleanEmbeddedChat({ buildingFmGuid, buildingName }: IleanEmbeddedChatProps) {
  const { messages, sendMessage, isLoading, isSending, contextEntity } = useIleanData();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isSending) return;
    sendMessage(input.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Context indicator */}
      <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border/50 bg-muted/30 shrink-0">
        {contextEntity.entityName
          ? `Kontext: ${contextEntity.entityName} (${contextEntity.entityType})`
          : buildingName
            ? `Kontext: ${buildingName}`
            : 'Ingen byggnadskontext'}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center space-y-3 pt-4">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Ställ frågor om dokument för {buildingName || 'denna byggnad'}.
            </p>
            <div className="space-y-1.5">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="block w-full text-left text-xs px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors text-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              'text-sm rounded-lg px-3 py-2 max-w-[90%]',
              msg.role === 'user'
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'bg-muted text-foreground'
            )}
          >
            {msg.role === 'assistant' ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              msg.content
            )}
          </div>
        ))}

        {isSending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Ilean tänker...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 p-3 border-t border-border/50">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ställ en fråga om dokument..."
          className="h-8 text-sm"
          disabled={isSending}
        />
        <Button
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={!input.trim() || isSending}
          onClick={handleSend}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
