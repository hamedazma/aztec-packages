#pragma once
#include "new_contract_data.hpp"
#include "optionally_revealed_data.hpp"
#include "public_data_read.hpp"
#include "public_data_update_request.hpp"

#include "aztec3/constants.hpp"
#include "aztec3/utils/array.hpp"
#include "aztec3/utils/types/circuit_types.hpp"
#include "aztec3/utils/types/convert.hpp"
#include "aztec3/utils/types/native_types.hpp"

#include <barretenberg/barretenberg.hpp>

namespace aztec3::circuits::abis {

using aztec3::utils::zero_array;
using aztec3::utils::types::CircuitTypes;
using aztec3::utils::types::NativeTypes;
using std::is_same;

template <typename NCT> struct CombinedAccumulatedData {
    using fr = typename NCT::fr;
    using uint32 = typename NCT::uint32;
    using boolean = typename NCT::boolean;
    using AggregationObject = typename NCT::AggregationObject;

    AggregationObject aggregation_object{};

    std::array<fr, KERNEL_NEW_COMMITMENTS_LENGTH> new_commitments = zero_array<fr, KERNEL_NEW_NULLIFIERS_LENGTH>();
    std::array<fr, KERNEL_NEW_NULLIFIERS_LENGTH> new_nullifiers = zero_array<fr, KERNEL_NEW_NULLIFIERS_LENGTH>();

    std::array<fr, KERNEL_PRIVATE_CALL_STACK_LENGTH> private_call_stack =
        zero_array<fr, KERNEL_PRIVATE_CALL_STACK_LENGTH>();
    std::array<fr, KERNEL_PUBLIC_CALL_STACK_LENGTH> public_call_stack =
        zero_array<fr, KERNEL_PUBLIC_CALL_STACK_LENGTH>();
    std::array<fr, KERNEL_NEW_L2_TO_L1_MSGS_LENGTH> new_l2_to_l1_msgs =
        zero_array<fr, KERNEL_NEW_L2_TO_L1_MSGS_LENGTH>();

    // sha256 hash of the log preimages (in two fields to accommodate all 256-bits of the hash)
    std::array<fr, 2> encrypted_logs_hash = zero_array<fr, 2>();
    std::array<fr, 2> unencrypted_logs_hash = zero_array<fr, 2>();

    // Here so that the gas cost of this request can be measured by circuits, without actually needing to feed in the
    // variable-length data.
    // TODO: Mike has this as uint32 but I have issue compiling it like that. Should it be used or is fr ok?
    fr encrypted_log_preimages_length = 0;
    fr unencrypted_log_preimages_length = 0;

    std::array<NewContractData<NCT>, KERNEL_NEW_CONTRACTS_LENGTH> new_contracts{};

    std::array<OptionallyRevealedData<NCT>, KERNEL_OPTIONALLY_REVEALED_DATA_LENGTH> optionally_revealed_data{};

    std::array<PublicDataUpdateRequest<NCT>, KERNEL_PUBLIC_DATA_UPDATE_REQUESTS_LENGTH> public_data_update_requests{};
    std::array<PublicDataRead<NCT>, KERNEL_PUBLIC_DATA_READS_LENGTH> public_data_reads{};

    // for serialization, update with new fields
    MSGPACK_FIELDS(aggregation_object,
                   new_commitments,
                   new_nullifiers,
                   private_call_stack,
                   public_call_stack,
                   new_l2_to_l1_msgs,
                   encrypted_logs_hash,
                   unencrypted_logs_hash,
                   encrypted_log_preimages_length,
                   unencrypted_log_preimages_length,
                   new_contracts,
                   optionally_revealed_data,
                   public_data_update_requests,
                   public_data_reads);
    boolean operator==(CombinedAccumulatedData<NCT> const& other) const
    {
        return aggregation_object == other.aggregation_object && new_commitments == other.new_commitments &&
               new_nullifiers == other.new_nullifiers && private_call_stack == other.private_call_stack &&
               public_call_stack == other.public_call_stack && new_l2_to_l1_msgs == other.new_l2_to_l1_msgs &&
               encrypted_logs_hash == other.encrypted_logs_hash &&
               unencrypted_logs_hash == other.unencrypted_logs_hash &&
               encrypted_log_preimages_length == other.encrypted_log_preimages_length &&
               unencrypted_log_preimages_length == other.unencrypted_log_preimages_length &&
               new_contracts == other.new_contracts && optionally_revealed_data == other.optionally_revealed_data &&
               public_data_update_requests == other.public_data_update_requests &&
               public_data_reads == other.public_data_reads;
    };

    template <typename Composer>
    CombinedAccumulatedData<CircuitTypes<Composer>> to_circuit_type(Composer& composer) const
    {
        typedef CircuitTypes<Composer> CT;
        static_assert((std::is_same<NativeTypes, NCT>::value));

        // Capture the composer:
        auto to_ct = [&](auto& e) { return aztec3::utils::types::to_ct(composer, e); };
        auto to_circuit_type = [&](auto& e) { return e.to_circuit_type(composer); };

        CombinedAccumulatedData<CT> acc_data = {
            typename CT::AggregationObject{
                to_ct(aggregation_object.P0),
                to_ct(aggregation_object.P1),
                to_ct(aggregation_object.public_inputs),
                aggregation_object.proof_witness_indices,
                aggregation_object.has_data,
            },

            to_ct(new_commitments),
            to_ct(new_nullifiers),

            to_ct(private_call_stack),
            to_ct(public_call_stack),
            to_ct(new_l2_to_l1_msgs),

            to_ct(encrypted_logs_hash),
            to_ct(unencrypted_logs_hash),

            to_ct(encrypted_log_preimages_length),
            to_ct(unencrypted_log_preimages_length),

            map(new_contracts, to_circuit_type),
            map(optionally_revealed_data, to_circuit_type),
            map(public_data_update_requests, to_circuit_type),
            map(public_data_reads, to_circuit_type),
        };

        return acc_data;
    };

    template <typename Composer> CombinedAccumulatedData<NativeTypes> to_native_type() const
    {
        static_assert(std::is_same<CircuitTypes<Composer>, NCT>::value);
        auto to_nt = [&](auto& e) { return aztec3::utils::types::to_nt<Composer>(e); };
        auto to_native_type = []<typename T>(T& e) { return e.template to_native_type<Composer>(); };

        CombinedAccumulatedData<NativeTypes> acc_data = {
            typename NativeTypes::AggregationObject{
                to_nt(aggregation_object.P0),
                to_nt(aggregation_object.P1),
                to_nt(aggregation_object.public_inputs),
                aggregation_object.proof_witness_indices,
                aggregation_object.has_data,
            },

            to_nt(new_commitments),
            to_nt(new_nullifiers),

            to_nt(private_call_stack),
            to_nt(public_call_stack),
            to_nt(new_l2_to_l1_msgs),

            to_nt(encrypted_logs_hash),
            to_nt(unencrypted_logs_hash),

            to_nt(encrypted_log_preimages_length),
            to_nt(unencrypted_log_preimages_length),

            map(new_contracts, to_native_type),
            map(optionally_revealed_data, to_native_type),
            map(public_data_update_requests, to_native_type),
            map(public_data_reads, to_native_type),
        };
        return acc_data;
    }

    void set_public()
    {
        static_assert(!(std::is_same<NativeTypes, NCT>::value));

        aggregation_object.add_proof_outputs_as_public_inputs();

        set_array_public(new_commitments);
        set_array_public(new_nullifiers);

        set_array_public(private_call_stack);
        set_array_public(public_call_stack);
        set_array_public(new_l2_to_l1_msgs);

        set_array_public(encrypted_logs_hash);
        set_array_public(unencrypted_logs_hash);

        set_array_public(new_contracts);
        set_array_public(optionally_revealed_data);
        set_array_public(public_data_update_requests);
        set_array_public(public_data_reads);
    }

    template <typename T, size_t SIZE> void set_array_public(std::array<T, SIZE>& arr)
    {
        static_assert(!(std::is_same<NativeTypes, NCT>::value));
        for (T& e : arr) {
            fr(e).set_public();
        }
    }

    template <size_t SIZE> void set_array_public(std::array<OptionallyRevealedData<NCT>, SIZE>& arr)
    {
        static_assert(!(std::is_same<NativeTypes, NCT>::value));
        for (auto& e : arr) {
            e.set_public();
        }
    }

    template <size_t SIZE> void set_array_public(std::array<NewContractData<NCT>, SIZE>& arr)
    {
        static_assert(!(std::is_same<NativeTypes, NCT>::value));
        for (auto& e : arr) {
            e.set_public();
        }
    }

    template <size_t SIZE> void set_array_public(std::array<PublicDataUpdateRequest<NCT>, SIZE>& arr)
    {
        static_assert(!(std::is_same<NativeTypes, NCT>::value));
        for (auto& e : arr) {
            e.set_public();
        }
    }

    template <size_t SIZE> void set_array_public(std::array<PublicDataRead<NCT>, SIZE>& arr)
    {
        static_assert(!(std::is_same<NativeTypes, NCT>::value));
        for (auto& e : arr) {
            e.set_public();
        }
    }
};

template <typename NCT> void read(uint8_t const*& it, CombinedAccumulatedData<NCT>& accum_data)
{
    using serialize::read;

    read(it, accum_data.aggregation_object);
    read(it, accum_data.new_commitments);
    read(it, accum_data.new_nullifiers);
    read(it, accum_data.private_call_stack);
    read(it, accum_data.public_call_stack);
    read(it, accum_data.new_l2_to_l1_msgs);
    read(it, accum_data.encrypted_logs_hash);
    read(it, accum_data.unencrypted_logs_hash);
    read(it, accum_data.encrypted_log_preimages_length);
    read(it, accum_data.unencrypted_log_preimages_length);
    read(it, accum_data.new_contracts);
    read(it, accum_data.optionally_revealed_data);
    read(it, accum_data.public_data_update_requests);
    read(it, accum_data.public_data_reads);
};

template <typename NCT> void write(std::vector<uint8_t>& buf, CombinedAccumulatedData<NCT> const& accum_data)
{
    using serialize::write;

    write(buf, accum_data.aggregation_object);
    write(buf, accum_data.new_commitments);
    write(buf, accum_data.new_nullifiers);
    write(buf, accum_data.private_call_stack);
    write(buf, accum_data.public_call_stack);
    write(buf, accum_data.new_l2_to_l1_msgs);
    write(buf, accum_data.encrypted_logs_hash);
    write(buf, accum_data.unencrypted_logs_hash);
    write(buf, accum_data.encrypted_log_preimages_length);
    write(buf, accum_data.unencrypted_log_preimages_length);
    write(buf, accum_data.new_contracts);
    write(buf, accum_data.optionally_revealed_data);
    write(buf, accum_data.public_data_update_requests);
    write(buf, accum_data.public_data_reads);
};

template <typename NCT> std::ostream& operator<<(std::ostream& os, CombinedAccumulatedData<NCT> const& accum_data)
{
    return os << "aggregation_object:\n"
              << accum_data.aggregation_object << "\n"
              << "new_commitments:\n"
              << accum_data.new_commitments << "\n"
              << "new_nullifiers:\n"
              << accum_data.new_nullifiers << "\n"
              << "private_call_stack:\n"
              << accum_data.private_call_stack << "\n"
              << "public_call_stack:\n"
              << accum_data.public_call_stack << "\n"
              << "new_l2_to_l1_msgs:\n"
              << accum_data.new_l2_to_l1_msgs << "\n"
              << "encrypted_logs_hash:\n"
              << accum_data.encrypted_logs_hash << "\n"
              << "unencrypted_logs_hash:\n"
              << accum_data.unencrypted_logs_hash << "\n"
              << "encrypted_log_preimages_length:\n"
              << accum_data.encrypted_log_preimages_length << "\n"
              << "unencrypted_log_preimages_length:\n"
              << accum_data.unencrypted_log_preimages_length << "\n"
              << "new_contracts:\n"
              << accum_data.new_contracts << "\n"
              << "optionally_revealed_data:\n"
              << accum_data.optionally_revealed_data << "\n"
              << "public_data_update_requests:\n"
              << accum_data.public_data_update_requests << "\n"
              << "public_data_reads:\n"
              << accum_data.public_data_reads << "\n";
}

}  // namespace aztec3::circuits::abis
