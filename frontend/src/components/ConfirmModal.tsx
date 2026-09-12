'use client';

import React from 'react';
import { AlertTriangle, Info, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
  isLoading?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Onayla',
  cancelText = 'İptal',
  variant = 'warning',
  isLoading = false
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const isAlertOnly = !onConfirm;

  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          icon: <XCircle className="w-6 h-6 text-destructive" />,
          iconBg: 'bg-destructive/10',
          confirmBtn: 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
        };
      case 'success':
        return {
          icon: <CheckCircle2 className="w-6 h-6 text-emerald-500" />,
          iconBg: 'bg-emerald-500/10',
          confirmBtn: 'bg-emerald-600 hover:bg-emerald-700 text-white'
        };
      case 'info':
        return {
          icon: <Info className="w-6 h-6 text-primary" />,
          iconBg: 'bg-primary/10',
          confirmBtn: 'bg-primary hover:bg-primary/90 text-primary-foreground'
        };
      case 'warning':
      default:
        return {
          icon: <AlertTriangle className="w-6 h-6 text-amber-500" />,
          iconBg: 'bg-amber-500/10',
          confirmBtn: 'bg-amber-600 hover:bg-amber-700 text-white'
        };
    }
  };

  const { icon, iconBg, confirmBtn } = getVariantStyles();

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-card border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-start gap-3.5">
          <div className={`p-2.5 rounded-xl shrink-0 ${iconBg}`}>
            {icon}
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-sm text-foreground">{title}</h3>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </div>
          </div>
        </div>

        <div className="pt-3 border-t flex justify-end gap-2.5">
          {!isAlertOnly && (
            <button
              type="button"
              disabled={isLoading}
              onClick={onClose}
              className="px-4 py-2 bg-muted/60 hover:bg-muted text-foreground text-xs font-semibold rounded-xl border transition-colors disabled:opacity-50"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            disabled={isLoading}
            onClick={() => {
              if (onConfirm) {
                onConfirm();
              } else {
                onClose();
              }
            }}
            className={`px-4 py-2 text-xs font-bold rounded-xl shadow transition-colors flex items-center gap-1.5 disabled:opacity-50 ${
              isAlertOnly ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : confirmBtn
            }`}
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> İşleniyor...
              </>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
