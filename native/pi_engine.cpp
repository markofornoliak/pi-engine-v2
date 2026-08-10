#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <gmp.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define PI_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define PI_EXPORT
#endif

namespace {

constexpr double DIGITS_PER_TERM = 14.181647462725477;
constexpr unsigned long GUARD_DIGITS = 32;
constexpr unsigned int MAX_THREADS = 8;

struct Big {
    mpz_t v;
    Big() { mpz_init(v); }
    ~Big() { mpz_clear(v); }
    Big(const Big&) = delete;
    Big& operator=(const Big&) = delete;
};

struct Part {
    Big p;
    Big q;
    Big t;
};

std::atomic<unsigned long> g_terms_done{0};
std::atomic<unsigned long> g_terms_total{0};

void binary_split(unsigned long a, unsigned long b, mpz_t P, mpz_t Q, mpz_t T) {
    if (b - a == 1) {
        if (a == 0) {
            mpz_set_ui(P, 1);
            mpz_set_ui(Q, 1);
            mpz_set_ui(T, 13591409UL);
        } else {
            Big k;
            mpz_set_ui(k.v, a);

            Big x1, x2, x3;
            mpz_mul_ui(x1.v, k.v, 6UL);
            mpz_sub_ui(x1.v, x1.v, 5UL);

            mpz_mul_ui(x2.v, k.v, 2UL);
            mpz_sub_ui(x2.v, x2.v, 1UL);

            mpz_mul_ui(x3.v, k.v, 6UL);
            mpz_sub_ui(x3.v, x3.v, 1UL);

            mpz_mul(P, x1.v, x2.v);
            mpz_mul(P, P, x3.v);

            mpz_mul(Q, k.v, k.v);
            mpz_mul(Q, Q, k.v);
            Big c3;
            mpz_set_str(c3.v, "10939058860032000", 10);
            mpz_mul(Q, Q, c3.v);

            Big linear;
            mpz_mul_ui(linear.v, k.v, 545140134UL);
            mpz_add_ui(linear.v, linear.v, 13591409UL);
            mpz_mul(T, P, linear.v);
            if (a & 1UL) mpz_neg(T, T);
        }
        g_terms_done.fetch_add(1, std::memory_order_relaxed);
        return;
    }

    const unsigned long m = a + (b - a) / 2;

    Big p1, q1, t1, p2, q2, t2, temp;
    binary_split(a, m, p1.v, q1.v, t1.v);
    binary_split(m, b, p2.v, q2.v, t2.v);

    mpz_mul(P, p1.v, p2.v);
    mpz_mul(Q, q1.v, q2.v);

    mpz_mul(T, t1.v, q2.v);
    mpz_mul(temp.v, p1.v, t2.v);
    mpz_add(T, T, temp.v);
}

void merge_parts(const Part& left, const Part& right, Part& out) {
    Big temp;
    mpz_mul(out.p.v, left.p.v, right.p.v);
    mpz_mul(out.q.v, left.q.v, right.q.v);
    mpz_mul(out.t.v, left.t.v, right.q.v);
    mpz_mul(temp.v, left.p.v, right.t.v);
    mpz_add(out.t.v, out.t.v, temp.v);
}

unsigned int normalize_threads(unsigned int requested, unsigned long terms) {
#ifdef __EMSCRIPTEN_PTHREADS__
    requested = std::max(1U, std::min(requested, MAX_THREADS));
    requested = std::min<unsigned int>(requested, static_cast<unsigned int>(std::max(1UL, terms)));
    if (terms < 500) return 1;
    return requested;
#else
    (void)requested;
    (void)terms;
    return 1;
#endif
}

std::unique_ptr<Part> compute_series(unsigned long terms, unsigned int requested_threads) {
    const unsigned int thread_count = normalize_threads(requested_threads, terms);

    if (thread_count == 1) {
        auto out = std::make_unique<Part>();
        binary_split(0, terms, out->p.v, out->q.v, out->t.v);
        return out;
    }

#ifdef __EMSCRIPTEN_PTHREADS__
    std::vector<std::unique_ptr<Part>> parts;
    parts.reserve(thread_count);
    for (unsigned int i = 0; i < thread_count; ++i) parts.push_back(std::make_unique<Part>());

    std::vector<std::thread> threads;
    threads.reserve(thread_count);

    for (unsigned int i = 0; i < thread_count; ++i) {
        const unsigned long a = (terms * i) / thread_count;
        const unsigned long b = (terms * (i + 1)) / thread_count;
        threads.emplace_back([a, b, &parts, i]() {
            binary_split(a, b, parts[i]->p.v, parts[i]->q.v, parts[i]->t.v);
        });
    }

    for (auto& th : threads) th.join();

    while (parts.size() > 1) {
        std::vector<std::unique_ptr<Part>> next;
        next.reserve((parts.size() + 1) / 2);
        for (std::size_t i = 0; i < parts.size(); i += 2) {
            if (i + 1 == parts.size()) {
                next.push_back(std::move(parts[i]));
            } else {
                auto merged = std::make_unique<Part>();
                merge_parts(*parts[i], *parts[i + 1], *merged);
                next.push_back(std::move(merged));
            }
        }
        parts = std::move(next);
    }
    return std::move(parts.front());
#else
    return nullptr;
#endif
}

char* compute_pi_buffer(unsigned long digits, unsigned int requested_threads) {
    const unsigned long scale_digits = digits + GUARD_DIGITS;
    const unsigned long terms = static_cast<unsigned long>(scale_digits / DIGITS_PER_TERM) + 2UL;

    g_terms_done.store(0, std::memory_order_relaxed);
    g_terms_total.store(terms, std::memory_order_relaxed);

    auto series = compute_series(terms, requested_threads);

    Big scale, square_input, root, numerator, pi_scaled;
    mpz_ui_pow_ui(scale.v, 10UL, scale_digits);
    mpz_mul(square_input.v, scale.v, scale.v);
    mpz_mul_ui(square_input.v, square_input.v, 10005UL);
    mpz_sqrt(root.v, square_input.v);

    mpz_mul(numerator.v, series->q.v, root.v);
    mpz_mul_ui(numerator.v, numerator.v, 426880UL);
    mpz_tdiv_q(pi_scaled.v, numerator.v, series->t.v);

    const std::size_t numeric_len = mpz_sizeinbase(pi_scaled.v, 10);
    const std::size_t needed = static_cast<std::size_t>(digits) + 1U;
    const std::size_t capacity = std::max(numeric_len + 4U, needed + 4U);

    char* raw = static_cast<char*>(std::malloc(capacity));
    if (!raw) return nullptr;
    mpz_get_str(raw, 10, pi_scaled.v);

    std::size_t length = std::strlen(raw);
    if (length < needed + 1U) {
        const std::size_t missing = needed + 1U - length;
        std::memmove(raw + missing, raw, length + 1U);
        std::memset(raw, '0', missing);
        length += missing;
    }

    const bool round_up = raw[needed] >= '5';
    if (round_up) {
        for (std::size_t i = needed; i-- > 0;) {
            if (raw[i] != '9') {
                ++raw[i];
                break;
            }
            raw[i] = '0';
        }
    }

    std::memmove(raw + 2, raw + 1, static_cast<std::size_t>(digits));
    raw[1] = '.';
    raw[static_cast<std::size_t>(digits) + 2U] = '\0';
    return raw;
}

} // namespace

extern "C" {

PI_EXPORT char* pi_compute(unsigned long digits, unsigned int threads) {
    if (digits == 0) return nullptr;
    try {
        return compute_pi_buffer(digits, threads);
    } catch (...) {
        return nullptr;
    }
}

PI_EXPORT void pi_free(char* ptr) {
    std::free(ptr);
}

PI_EXPORT unsigned long pi_terms_done() {
    return g_terms_done.load(std::memory_order_relaxed);
}

PI_EXPORT unsigned long pi_terms_total() {
    return g_terms_total.load(std::memory_order_relaxed);
}

PI_EXPORT unsigned int pi_max_threads() {
#ifdef __EMSCRIPTEN_PTHREADS__
    return MAX_THREADS;
#else
    return 1;
#endif
}

}

#ifndef __EMSCRIPTEN__
#include <iostream>
int main(int argc, char** argv) {
    const unsigned long digits = argc > 1 ? std::stoul(argv[1]) : 100;
    const unsigned int threads = argc > 2 ? static_cast<unsigned int>(std::stoul(argv[2])) : 1U;
    char* result = compute_pi_buffer(digits, threads);
    if (!result) return 2;
    std::cout << result << '\n';
    std::free(result);
    return 0;
}
#endif
