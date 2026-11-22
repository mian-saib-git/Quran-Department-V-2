import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { QuranTeacherSessionSubstitute } from "../services/djangoApiService";
import { filterSubstituteTeachers } from "../services/substituteSearch";

type SubstituteTeacherSelectProps = {
  substitutes: QuranTeacherSessionSubstitute[];
  value: string;
  onChange: (teacherId: string) => void;
  disabledIds?: Set<string>;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  fallbackSelectedLabel?: string;
  compact?: boolean;
  ariaLabel?: string;
};

export function SubstituteTeacherSelect({
  substitutes,
  value,
  onChange,
  disabledIds,
  loading = false,
  disabled = false,
  placeholder = "Select substitute teacher",
  fallbackSelectedLabel = "",
  compact = false,
  ariaLabel = "Select substitute teacher",
}: SubstituteTeacherSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    openUpward: boolean;
  } | null>(null);

  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedTeacher = useMemo(
    () => substitutes.find((item) => String(item.id) === value) || null,
    [substitutes, value],
  );

  const filteredSubstitutes = useMemo(
    () => filterSubstituteTeachers(substitutes, searchQuery),
    [substitutes, searchQuery],
  );

  const isOptionDisabled = (teacherId: number) =>
    Boolean(disabledIds && disabledIds.has(String(teacherId)));

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const estimatedMenuHeight = 300;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < estimatedMenuHeight && rect.top > spaceBelow;
    const width = Math.max(rect.width, 260);
    const maxLeft = Math.max(8, window.innerWidth - width - 8);

    setMenuPosition({
      top: openUpward ? Math.max(8, rect.top - 6) : Math.min(window.innerHeight - 8, rect.bottom + 6),
      left: Math.min(Math.max(8, rect.left), maxLeft),
      width,
      openUpward,
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();

    const handleReposition = () => updateMenuPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        containerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setActiveIndex(-1);
      return;
    }
    const selectedIdx = filteredSubstitutes.findIndex(
      (item) => String(item.id) === value && !isOptionDisabled(item.id),
    );
    if (selectedIdx >= 0) {
      setActiveIndex(selectedIdx);
    } else {
      const firstEnabled = filteredSubstitutes.findIndex(
        (item) => !isOptionDisabled(item.id),
      );
      setActiveIndex(firstEnabled);
    }
  }, [isOpen, searchQuery, substitutes]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeIndex]);

  const moveActiveIndex = (direction: 1 | -1) => {
    if (filteredSubstitutes.length === 0) return;
    let index = activeIndex;
    for (let step = 0; step < filteredSubstitutes.length; step += 1) {
      index =
        (index + direction + filteredSubstitutes.length) %
        filteredSubstitutes.length;
      if (!isOptionDisabled(filteredSubstitutes[index].id)) {
        setActiveIndex(index);
        return;
      }
    }
  };

  const selectTeacher = (teacher: QuranTeacherSessionSubstitute) => {
    if (isOptionDisabled(teacher.id)) return;
    onChange(String(teacher.id));
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled || loading) return;

    if (!isOpen) {
      if (
        event.key === "ArrowDown" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveIndex(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveIndex(-1);
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      const candidate = filteredSubstitutes[activeIndex];
      if (candidate && !isOptionDisabled(candidate.id)) {
        event.preventDefault();
        selectTeacher(candidate);
      }
    }
  };

  const displayLabel = selectedTeacher
    ? `${selectedTeacher.name} (ID #${selectedTeacher.id})`
    : value && fallbackSelectedLabel
      ? fallbackSelectedLabel
      : "";

  const triggerClasses = compact
    ? "w-full sm:w-64 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[10px] font-bold text-slate-800"
    : "w-full md:w-80 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800";

  const menu =
    isOpen && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: menuPosition.top,
              left: menuPosition.left,
              width: menuPosition.width,
              transform: menuPosition.openUpward ? "translateY(-100%)" : undefined,
            }}
            className="z-[100000] rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            onKeyDown={handleKeyDown}
          >
            <div className="border-b border-slate-100 p-2 bg-slate-50/70">
              <div className="relative flex items-center">
                <Search
                  size={compact ? 13 : 15}
                  className="pointer-events-none absolute left-2.5 text-slate-400"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by teacher name or ID..."
                  aria-label="Search substitute teacher by name or ID"
                  className={`w-full rounded-xl border border-slate-200 bg-white pl-8 pr-7 outline-none focus:border-indigo-400 ${
                    compact ? "py-1.5 text-[11px]" : "py-2 text-xs"
                  } font-semibold text-slate-800`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="absolute right-2 text-slate-400 hover:text-slate-600"
                  >
                    <X size={compact ? 12 : 14} />
                  </button>
                )}
              </div>
            </div>

            <div
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              className="max-h-60 overflow-y-auto p-1.5"
            >
              {loading ? (
                <div className="px-3 py-4 text-center text-xs font-semibold text-slate-500">
                  Loading substitute teachers...
                </div>
              ) : substitutes.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs font-semibold text-slate-500">
                  No active substitute teachers found in this department.
                </div>
              ) : filteredSubstitutes.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs font-semibold text-slate-500">
                  <div>No matching teachers for "{searchQuery}".</div>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                    className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                filteredSubstitutes.map((teacher, index) => {
                  const candidateId = String(teacher.id);
                  const isSelected = candidateId === value;
                  const optionDisabled = isOptionDisabled(teacher.id);
                  const isActive = index === activeIndex;

                  return (
                    <button
                      key={teacher.id}
                      ref={(el) => {
                        optionRefs.current[index] = el;
                      }}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={optionDisabled}
                      onMouseEnter={() => {
                        if (!optionDisabled) setActiveIndex(index);
                      }}
                      onClick={() => selectTeacher(teacher)}
                      className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                        optionDisabled
                          ? "cursor-not-allowed opacity-45 text-slate-400"
                          : isSelected
                            ? "bg-indigo-50 text-indigo-900"
                            : isActive
                              ? "bg-slate-100 text-slate-900"
                              : "text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate font-bold ${
                            compact ? "text-[11px]" : "text-xs"
                          }`}
                        >
                          {teacher.name}
                        </div>
                        <div className="text-[10px] font-semibold text-slate-500">
                          ID #{teacher.id}
                          {optionDisabled ? " · Already assigned in this session" : ""}
                        </div>
                      </div>
                      {isSelected && (
                        <Check size={14} className="shrink-0 text-indigo-600" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1">
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          disabled={disabled || loading}
          onClick={() => {
            if (!disabled && !loading) {
              setIsOpen((prev) => !prev);
            }
          }}
          onKeyDown={handleKeyDown}
          className={`${triggerClasses} flex items-center justify-between gap-2 text-left outline-none transition focus:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <span
            className={`truncate ${
              displayLabel ? "text-slate-900" : "text-slate-400"
            }`}
          >
            {loading ? "Loading teachers..." : displayLabel || placeholder}
          </span>
          <ChevronDown
            size={compact ? 14 : 16}
            className={`shrink-0 text-slate-400 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {value && !disabled && !loading && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              triggerRef.current?.focus();
            }}
            aria-label="Clear substitute teacher selection"
            title="Clear selection"
            className={`shrink-0 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 ${
              compact ? "p-1.5" : "p-2.5"
            }`}
          >
            <X size={compact ? 12 : 14} />
          </button>
        )}
      </div>

      {menu}
    </div>
  );
}
