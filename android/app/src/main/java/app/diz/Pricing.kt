package app.diz

/** Same price table as src/pricing.ts. */
object Pricing {
    private val base: Map<String, Map<Int, Int>> = mapOf(
        "junk" to mapOf(1 to 25000, 2 to 45000, 3 to 75000),
        "moving" to mapOf(1 to 60000, 2 to 120000, 3 to 250000),
        "goods" to mapOf(1 to 10000, 2 to 20000),
        "pro" to mapOf(1 to 30000, 2 to 70000, 3 to 50000),
        "towing" to mapOf(1 to 40000, 2 to 60000, 3 to 100000),
        "deliver" to mapOf(1 to 8000, 2 to 15000),
    )
    private val bump: Map<String, Map<String, Int>> = mapOf(
        "junk" to mapOf("appliances" to 5000, "electronics" to 3000, "leftover" to 10000),
        "moving" to mapOf("apartment" to 15000, "house" to 40000),
        "goods" to mapOf("electronics" to 5000, "furniture" to 10000),
        "pro" to mapOf("electrician" to 5000, "plumber" to 5000, "painter" to 4000),
        "towing" to mapOf("accident" to 15000, "transport" to -10000),
        "deliver" to mapOf("fragile" to 5000, "package" to 2000),
    )

    fun price(service: String, size: Int?, cat: String?): Int {
        val b = base[service]?.get(size ?: 0) ?: 200
        val extra = bump[service]?.get(cat ?: "") ?: 0
        return b + extra
    }
}
